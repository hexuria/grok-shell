// gen-server.mjs — the "AI" behind the generative-UI chat.
//
//   node tools/gen-server.mjs            # uses OPENROUTER_API_KEY if set
//   MOCK=1 node tools/gen-server.mjs     # canned modules, no network needed
//
// POST http://127.0.0.1:8787/chat {"prompt": "…"}
//
// Flow per message: record the user turn → ask the model for one nsh TSX
// module → write generated/r<N>.tsx → regenerate generated/index.tsx →
// `nsh build` to check it → on failure, retry once with the compiler error,
// then fall back to an error card. nsh's dev server sees the new files and
// hot-patches the running app, so the reply appears as real native UI.

import { createServer } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GEN_DIR = join(APP_ROOT, "generated");
// Candidates are compiled+typechecked here first — OUTSIDE the app's import
// graph — so a bad module never reaches the dev server (no red overlay flash).
const STAGE_DIR = join(APP_ROOT, "tools", ".stage");
const PORT = Number(process.env.PORT || 8787);
// Providers: Anthropic Messages API when ANTHROPIC_API_KEY is set (default
// model claude-haiku-5-5), otherwise any OpenAI-compatible endpoint —
// OpenRouter by default, or GEN_BASE_URL=https://api.openai.com/v1 etc.
const PROVIDER =
  process.env.GEN_PROVIDER ||
  (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai");
const BASE_URL =
  process.env.GEN_BASE_URL || "https://openrouter.ai/api/v1";
const MODEL =
  process.env.GEN_MODEL ||
  (PROVIDER === "anthropic" ? "claude-haiku-5-5" : "openai/gpt-4o-mini");
const MAX_TOKENS = Number(process.env.GEN_MAX_TOKENS || 6000);
const MOCK = !!process.env.MOCK;
const NSH = process.env.NSH || "nsh";
const anthropic =
  PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY
    ? new Anthropic()
    : null;

mkdirSync(GEN_DIR, { recursive: true });
mkdirSync(STAGE_DIR, { recursive: true });

// ————— live job status (polled by the app via GET /status?id=N) —————
const jobs = new Map();
let nextJobId = 1;

function setJob(job, phase, detail = "") {
  if (job) Object.assign(job, { phase, detail, seq: job.seq + 1 });
}

function jobJson(job) {
  return JSON.stringify({
    id: job.id,
    seq: job.seq,
    phase: job.phase,
    detail: job.detail,
    done: job.done,
    result: job.result,
  });
}

// ————— the app's own database (node:sqlite, generated/app.db) —————
//   threads / turns — the chat history
//   widgets         — published copies of generated modules (the shelf)
//   kv              — per-widget persisted state, written by the widgets
//                     themselves through GET/POST /state
const WIDGETS_DIR = join(APP_ROOT, "widgets");
mkdirSync(WIDGETS_DIR, { recursive: true });

const db = new DatabaseSync(join(GEN_DIR, "app.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS threads(
    id TEXT PRIMARY KEY, title TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS turns(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL,
    text TEXT, name TEXT, label TEXT, caption TEXT, reaction TEXT,
    retries INTEGER DEFAULT 0, widget INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS widgets(
    name TEXT PRIMARY KEY, title TEXT, prompt TEXT, published_at TEXT);
  CREATE TABLE IF NOT EXISTS kv(name TEXT PRIMARY KEY, data TEXT);
`);

const metaGet = (k) => db.prepare("SELECT v FROM meta WHERE k=?").get(k)?.v;
const metaSet = (k, v) =>
  db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)").run(k, v);

function loadStore() {
  const s = {
    active: metaGet("active") || "t1",
    seq: Number(metaGet("seq") || 0),
    list: [],
  };
  for (const t of db.prepare("SELECT * FROM threads ORDER BY ord").all())
    s.list.push({
      id: t.id,
      title: t.title,
      turns: db
        .prepare("SELECT * FROM turns WHERE thread_id=? ORDER BY seq")
        .all(t.id)
        .map((u) =>
          u.role === "user"
            ? { role: "user", text: u.text }
            : {
                role: "ai",
                name: u.name,
                label: u.label || "",
                caption: u.caption || "",
                reaction: u.reaction || "",
                retries: u.retries || 0,
                widget: !!u.widget,
              },
        ),
    });
  return s;
}

// First boot: import the JSON files the older server wrote, then the DB is
// the source of truth (atomic multi-statement writes, no more torn JSON).
const LEGACY_STATE = join(GEN_DIR, "threads.json");
const LEGACY_TURNS = join(GEN_DIR, "turns.json");
let store = loadStore();
if (store.list.length === 0 && existsSync(LEGACY_STATE)) {
  store = JSON.parse(readFileSync(LEGACY_STATE, "utf8"));
  console.log(`migrated threads.json → app.db (${store.list.length} threads)`);
} else if (store.list.length === 0) {
  store = {
    active: "t1",
    seq: 0,
    list: [
      {
        id: "t1",
        title: "first chat",
        turns: existsSync(LEGACY_TURNS)
          ? JSON.parse(readFileSync(LEGACY_TURNS, "utf8"))
          : [],
      },
    ],
  };
}

function persist() {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM threads");
    db.exec("DELETE FROM turns");
    const it = db.prepare(
      "INSERT INTO threads(id,title,ord) VALUES(?,?,?)",
    );
    const iu = db.prepare(
      `INSERT INTO turns(thread_id,seq,role,text,name,label,caption,reaction,retries,widget)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    );
    store.list.forEach((t, i) => {
      it.run(t.id, t.title, i);
      t.turns.forEach((u, j) =>
        iu.run(
          t.id, j, u.role, u.text ?? null, u.name ?? null, u.label ?? null,
          u.caption ?? null, u.reaction ?? null, u.retries ?? 0,
          u.widget ? 1 : 0,
        ),
      );
    });
    metaSet("active", store.active);
    metaSet("seq", String(seq));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
// Module names must never collide with files already on disk — even files a
// deleted/crashed thread left behind.
const maxOnDisk = Math.max(
  0,
  ...readdirSync(GEN_DIR)
    .map((f) => /^R(\d+)\.tsx$/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1])),
);
let seq = Math.max(store.seq || 0, maxOnDisk);
store.seq = seq;
let threadSeq =
  Math.max(0, ...store.list.map((t) => Number(t.id.slice(1)) || 0)) + 1;
const activeThread = () =>
  store.list.find((t) => t.id === store.active) || store.list[0];

const systemFor = (name) => `You write Native Shell (nsh) modules: ONE TSX file, rendered as native UI (UIKit/AppKit). You are writing module ${name}.
Reply format: optionally ONE short markdown caption line (may use **bold**, \`code\`, $math$ — rendered natively above your widget), then the module inside a single \`\`\`tsx fenced block. No other prose, no second code block.

Contract:
- Exactly one default export: \`export default function R()\` returning JSX. Never call mount().
- IMPORT EVERY NAME YOU USE: signal, Text, View, Scroll, Input come from "nsh" (add every one you reference); List from "nsh/list"; Canvas from "nsh/canvas". Never import react/react-native/npm packages.
- <If when={cond}> and <Each of={array}>{(item, i) => …}</Each> are globals, no import. 'of' takes an ARRAY — pass the value, e.g. of={items()} or of={board()}, never the function itself. Each's row parameters are ACCESSORS — call them: item().field, i(). Never use them as plain values: wrong is 'item * 2' or 'item + "px"', right is 'item() * 2'.
- GAME/ANIMATION LOOPS: setInterval/setTimeout/clearInterval are globals returning number. Wrap timers in effect+cleanup (both imported from "nsh"): effect(() => { const t = setInterval(tick, 300); cleanup(() => clearInterval(t)); }); — tick mutates signals, UI follows.
- GRIDS/CANVAS GAMES: prefer <Canvas draw={(ctx, size) => {...}} style={{ width: W, height: H }} /> from "nsh/canvas" over hundreds of Views — it redraws automatically whenever a signal read inside draw() changes. ctx is CanvasRenderingContext2D (fillRect, fillStyle, etc.).
- Components run ONCE. State: const x = signal(0); read x() in JSX; write x.set(v)/x.update(fn) in handlers. Buttons: <View onPress={fn} activeOpacity={0.7}>.
- Every visible string must be inside <Text> — bare strings in <View> render nothing.
- Style with Tailwind: class="…" using only common utilities: flex, flex-row, flex-1, gap-N, p-N, px-N, py-N, m-N, mt-N, mb-N, rounded*, border, border-*, bg-*, text-* (size AND color), font-*, items-*, justify-*, self-*, w-N, h-N, max-w-*, min-h-*, overflow-hidden, opacity-*. Or style={{ camelCase }} — flexbox, column default, numbers in points.
- PERSISTED STATE: the app has a database — every widget that produces data worth remembering MUST persist it. Scores, streaks, session counts, check-ins, notes, settings, timers' completions: if the widget counts or collects anything, save it. fetch ONLY http://127.0.0.1:8787/state/${name} (all other hosts are sandbox-blocked). On mount restore once: const S = "${name}"; fetch(\`http://127.0.0.1:8787/state/\${S}\`).then(r=>r.json()).then(d=>{ if (d && d.state) /* set your signals from d.state fields */ }). Save via POST (replaces the stored object): fetch(\`http://127.0.0.1:8787/state/\${S}\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ score: score(), done: done() }) }). Put saves in a save() called from the same handlers that mutate state; never save during render. A pomodoro persists { sessions, minutesFocused }; a habit tracker { streak, lastCheckIn }; a game { best, plays }.
- No props, no imports beyond nsh modules, no fetch other than /state: render standalone inside a ~340pt-wide chat card.
- Make it a small, polished, interactive widget for the user's request: cards, charts as View bars, forms, lists, counters, steppers, games with real loops. Compact code, but take the lines a working game needs (~150 is fine).`;

function userBubble(text) {
  return `<View class="max-w-[85%] self-end px-4 py-2.5" style={{ backgroundColor: "#2f2f2f", borderRadius: 20 }}><Text class="text-[15px]" style={{ color: "#ececec" }}>{${JSON.stringify(
    text,
  )}}</Text></View>`;
}

function aiCard(t) {
  const label = t.widget
    ? `widget · ${t.name}.tsx`
    : `generated · ${t.name}.tsx · ${t.label}${t.retries ? ` · ↻${t.retries}` : ""}`;
  // Widget turns render ../widgets/R<n> as <R<n>w> — the alias keeps the
  // binding unique if the same module also appears as a generated card.
  const tag = t.widget ? `${t.name}w` : t.name;
  return `<CardShell name=${JSON.stringify(t.name)} label=${JSON.stringify(label)} caption=${JSON.stringify(t.caption || "")} reaction=${JSON.stringify(t.reaction || "")}><${tag} /></CardShell>`;
}

const dirOf = (t) => (t.widget ? WIDGETS_DIR : GEN_DIR);

function writeIndex() {
  const turns = activeThread().turns;
  // Never import a module that isn't on disk — a crashed job would leave a
  // phantom turn and the whole conversation build fails on the device.
  const ais = turns.filter(
    (t) => t.role === "ai" && existsSync(join(dirOf(t), `${t.name}.tsx`)),
  );
  const missing = new Set(
    turns
      .filter((t) => t.role === "ai" && !ais.includes(t))
      .map((t) => t.name),
  );
  const imports = ais
    .map((t) =>
      t.widget
        ? `import ${t.name}w from "../widgets/${t.name}";`
        : `import ${t.name} from "./${t.name}";`,
    )
    .join("\n");
  const body = turns
    .map((t) =>
      t.role === "user"
        ? userBubble(t.text)
        : missing.has(t.name)
          ? ""
          : aiCard(t),
    )
    .join("\n      ");
  const src = `import { Text, View } from "nsh";
import { CardShell } from "../shell";
${imports}

// Regenerated by tools/gen-server.mjs after every chat message.

export function Conversation() {
  return (
    <View class="gap-3 px-4 py-4">
      ${body}
    </View>
  );
}
`;
  writeFileSync(join(GEN_DIR, "index.tsx"), src);
  store.seq = seq;
  persist();
}

// Regenerate widgets/index.tsx — the shelf the Work tab renders. Each card
// wraps one published (frozen) module with a "send to chat" action that
// re-renders it inside the active conversation.
function writeShelf() {
  const ws = db
    .prepare("SELECT * FROM widgets ORDER BY published_at")
    .all()
    .filter((w) => existsSync(join(WIDGETS_DIR, `${w.name}.tsx`)));
  const imports = ws
    .map((w) => `import W_${w.name} from "./${w.name}";`)
    .join("\n");
  const cards = ws
    .map(
      (w) => `
      <View class="rounded-2xl border border-[#2a2a2a] bg-[#181818] p-3">
        <View class="flex-row items-center justify-between pb-2">
          <View>
            <Text style={{ color: "#ececec", fontSize: 13, fontWeight: "600" }}>{${JSON.stringify(
              w.title || w.name,
            )}}</Text>
            <Text style={{ color: "#6e6e73", fontSize: 10 }}>{${JSON.stringify(
              `${w.name}.tsx · published ${w.published_at?.slice(0, 10) || ""}`,
            )}}</Text>
          </View>
          <View class="flex-row gap-2">
            <View onPress={() => sendToChat(${JSON.stringify(w.name)})} activeOpacity={0.7} style={{ borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: "#2f2f2f" }}>
              <Text style={{ color: "#ececec", fontSize: 11 }}>{sent() === ${JSON.stringify(
                w.name,
              )} ? "＋ chat ✓" : "＋ chat"}</Text>
            </View>
            <View onPress={() => unpublish(${JSON.stringify(w.name)})} activeOpacity={0.7} style={{ borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 }}>
              <Text style={{ color: "#6e6e73", fontSize: 11 }}>✕</Text>
            </View>
          </View>
        </View>
        <W_${w.name} />
      </View>`,
    )
    .join("\n");
  const src = `import { signal, Text, View } from "nsh";
${imports}

// Regenerated by tools/gen-server.mjs whenever a widget is published or
// removed. The Work tab renders this shelf — each card is a frozen copy of a
// published generated module.

const GEN = "http://127.0.0.1:8787";
const post = (path: string, body: object) =>
  fetch(\`\${GEN}\${path}\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);

export function WidgetShelf() {
  const sent = signal("");
  const sendToChat = (name: string) =>
    post("/reuse", { name }).then(() => {
      sent.set(name);
      setTimeout(() => sent.set(""), 1500);
    });
  const unpublish = (name: string) => post("/unpublish", { name });
  return (
    <View class="gap-3 px-4 py-4">
      <Text style={{ color: "#6e6e73", fontSize: 12, fontWeight: "600" }}>
        PUBLISHED WIDGETS — ${ws.length}
      </Text>
      ${cards || '<Text style={{ color: "#6e6e73", fontSize: 13 }}>No published widgets yet — tap ⬆ on a generated card to save it here.</Text>'}
    </View>
  );
}
`;
  writeFileSync(join(WIDGETS_DIR, "index.tsx"), src);
}

const widgetRow = (name) =>
  db.prepare("SELECT * FROM widgets WHERE name=?").get(name);

function extractCode(raw) {
  const text = String(raw || "").trim();
  let code = text;
  let caption = "";
  const m = text.match(/```(?:tsx?|jsx?)?\s*\n([\s\S]*?)```/);
  if (m) {
    code = m[1].trim();
    // everything outside the fence is the model's markdown caption
    caption = (text.slice(0, m.index) + text.slice((m.index || 0) + m[0].length))
      .replace(/```[\s\S]*?```/g, "")
      .trim();
  }
  if (!code.includes("export default")) {
    const def = code.match(/function\s+R\s*\(/);
    if (def) code += "\nexport default R;\n";
  }
  if (!code.includes("export default") || !code.includes("<"))
    throw new Error("model did not return a module");
  return { caption, code };
}

async function askModel(job, prompt, prevError, prevCode, name) {
  if (MOCK) return { caption: "", code: mockModule(prompt) };
  const messages = [{ role: "user", content: prompt }];
  if (prevError) {
    if (typeof prevCode === "string")
      messages.push({ role: "assistant", content: prevCode });
    messages.push({
      role: "user",
      content: `The nsh compiler rejected it:\n${prevError}\nReturn a corrected module only.`,
    });
  }
  if (PROVIDER === "anthropic") {
    try {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // haiku-5.5 deprecates temperature — omit it
        system: systemFor(name),
        messages,
      });
      stream.on("text", (_delta, snapshot) =>
        setJob(job, "writing", `streaming module · ${snapshot.length} chars`),
      );
      const msg = await stream.finalMessage();
      return extractCode(
        msg.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join(""),
      );
    } catch (e) {
      throw new Error(`llm ${e.status ?? ""}: ${e.message}`);
    }
  }
  const r = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: systemFor(name) }, ...messages],
      temperature: 0.4,
      max_tokens: MAX_TOKENS,
    }),
  });
  if (!r.ok) throw new Error(`llm ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return extractCode(data.choices?.[0]?.message?.content);
}

function runNsh(args) {
  return new Promise((resolve) => {
    execFile(NSH, args, { timeout: 90000 }, (err, stdout, stderr) =>
      resolve(err ? String(stdout) + String(stderr) : null),
    );
  });
}

// nsh names the model is allowed to use without thinking about imports —
// inject the ones it forgets instead of failing the module.
const CORE_NAMES = [
  "batch", "cleanup", "computed", "context", "effect", "Input", "mount",
  "Scroll", "signal", "split", "Text", "untracked", "View",
];
const MODULE_NAMES = {
  Canvas: "nsh/canvas",
  Image: "nsh/image",
  List: "nsh/list",
  Video: "nsh/video",
  WebView: "nsh/webview",
  Button: "nsh/ui/mobile",
  Card: "nsh/ui/mobile",
  Keyboard: "nsh/ui/mobile",
  KeyboardAvoidingView: "nsh/ui/mobile",
  SafeAreaView: "nsh/ui/mobile",
  StatusBar: "nsh/ui/mobile",
  TextField: "nsh/ui/mobile",
};

function fixImports(code) {
  // Drop imports nsh can't resolve (react, react-native, …).
  code = code.replace(
    /^[ \t]*import[^\n]*from\s*["'](react|react-native|solid-js|preact|vue|svelte)[^\n]*\n/gm,
    "",
  );
  const imported = new Set();
  for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g))
    for (const s of m[1].split(","))
      imported.add(s.trim().split(/\s+as\s+/)[0].trim());
  const missing = (n) => new RegExp(`\\b${n}\\b`).test(code) && !imported.has(n);
  const core = CORE_NAMES.filter(missing);
  const byMod = new Map();
  for (const [n, mod] of Object.entries(MODULE_NAMES))
    if (missing(n)) (byMod.get(mod) ?? byMod.set(mod, []).get(mod)).push(n);

  if (
    core.length &&
    /import\s*\{[^}]*\}\s*from\s*["']nsh["']/.test(code)
  )
    code = code.replace(
      /import\s*\{([^}]*)\}\s*from\s*["']nsh["']/,
      (m, names) =>
        `import { ${[...names.split(",").map((s) => s.trim()), ...core].join(
          ", ",
        )} } from "nsh"`,
    );
  else if (core.length)
    code = `import { ${core.join(", ")} } from "nsh";\n` + code;

  const extra = [...byMod].map(
    ([mod, names]) => `import { ${names.join(", ")} } from "${mod}";`,
  );
  if (extra.length) code = extra.join("\n") + "\n" + code;
  return code;
}

// Compile + typecheck the staged candidate; the app on the device is untouched
// until this passes. Entry/output are per-module so concurrent chats don't
// clobber each other's validation.
async function checkCandidate(name) {
  const entry = join(STAGE_DIR, `check-${name}.tsx`);
  writeFileSync(
    entry,
    `import { mount } from "nsh";\nimport R from "./${name}";\nmount(R);\n`,
  );
  const buildErr = await runNsh([
    "build",
    entry,
    "--out",
    join(STAGE_DIR, `out-${name}`),
  ]);
  if (buildErr) return buildErr;
  return runNsh(["check", entry]);
}

function errorCard(note) {
  return `import { Text, View } from "nsh";

export default function R() {
  return (
    <View class="gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <Text class="text-sm font-semibold text-red-700">generation failed</Text>
      <Text class="text-xs text-red-600">{${JSON.stringify(
        note.slice(0, 600),
      )}}</Text>
    </View>
  );
}
`;
}

async function generate(job, prompt) {
  // The job stays on the thread it was sent from — you can switch threads
  // while a generation is still running and it lands where it belongs.
  const thread =
    store.list.find((t) => t.id === job.thread) || activeThread();
  let name, aiTurn;
  if (job.retry) {
    // Try-again: regenerate INTO the same module file — the card hot-patches
    // in place instead of appending a duplicate reply.
    name = job.retry;
    aiTurn = thread.turns.find((t) => t.role === "ai" && t.name === name);
    if (!aiTurn) aiTurn = { role: "ai", name, label: MODEL };
    aiTurn.retries = (aiTurn.retries || 0) + 1;
  } else {
    seq += 1;
    name = `R${seq}`;
    if (thread.turns.length === 0) thread.title = prompt.slice(0, 42);
    thread.turns.push({ role: "user", text: prompt });
    aiTurn = { role: "ai", name, label: MODEL };
    thread.turns.push(aiTurn);
  }

  // llm → llm with the compiler error → canned mock, whichever compiles first.
  const useLlm =
    !MOCK &&
    !!(PROVIDER === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENROUTER_API_KEY);
  let lastCode;
  let lastCaption = "";
  let err = null;
  let ok = false;
  let used = useLlm ? MODEL : "mock";

  const tryCode = async (code) => {
    lastCode = fixImports(code);
    // check in staging — nothing lands in generated/ until it compiles
    writeFileSync(join(STAGE_DIR, `${name}.tsx`), lastCode);
    setJob(job, "checking", `nsh build + typecheck ${name}.tsx`);
    err = await checkCandidate(name);
    return err === null;
  };

  if (useLlm)
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (attempt > 0)
        setJob(
          job,
          "retrying",
          `compile error — feeding it back to the model (attempt ${attempt + 1})`,
        );
      else setJob(job, "thinking", `${MODEL} is working on it`);
      try {
        const r = await askModel(job, prompt, err, lastCode, name);
        lastCaption = r.caption || "";
        ok = await tryCode(r.code);
        if (!ok)
          console.error(
            `  attempt ${attempt + 1} rejected by nsh check: ${err?.split("\n")[0]}`,
          );
      } catch (e) {
        err = String(e?.message || e);
        console.error(`  llm call failed: ${err.split("\n")[0]}`);
        if (err.startsWith("llm")) break; // API dead — don't retry it
      }
    }

  if (!ok) {
    used = useLlm ? "mock-fallback" : "mock";
    setJob(job, "fallback", "model path failed — building a canned module");
    ok = await tryCode(mockModule(prompt)).catch(() => false);
  }
  aiTurn.label = used;
  aiTurn.caption = ok && used === MODEL ? lastCaption : "";
  if (!ok) console.error(`✗ ${name}: generation failed\n${err}`);
  setJob(job, "publishing", `hot-patching ${name}.tsx into the app`);
  // Write the module FIRST, then pause so the dev server's watcher registers
  // it before index.tsx starts importing it — otherwise the rebuild races the
  // new file and the device shows [UNRESOLVED_IMPORT]. Retrying a published
  // widget updates the widget copy, not the thread's original card.
  writeFileSync(
    join(dirOf(aiTurn), `${name}.tsx`),
    ok ? lastCode : errorCard(err || "unknown"),
  );
  await new Promise((r) => setTimeout(r, 500));
  writeIndex(); // one live write → one clean hot patch on the device
  const line = `${name}.tsx via ${used}`;
  console.log(`${ok ? "✓" : "✗"} ${line} (${prompt.slice(0, 60)})`);
  setJob(job, "done", `${ok ? "rendered" : "failed"} — ${line}`);
  job.done = true;
  job.result = line;
}

// ————— canned modules for MOCK mode / offline —————

function mockModule(prompt) {
  const p = prompt.toLowerCase();
  if (/counter|count|stepper/.test(p))
    return `import { signal, Text, View } from "nsh";

export default function R() {
  const n = signal(0);
  return (
    <View class="items-center gap-3 py-2">
      <Text class="text-5xl font-bold text-zinc-900">{n()}</Text>
      <View class="flex-row gap-3">
        <View onPress={() => n.update((v) => v - 1)} activeOpacity={0.6} class="rounded-lg bg-zinc-200 px-5 py-2"><Text class="text-lg">−</Text></View>
        <View onPress={() => n.update((v) => v + 1)} activeOpacity={0.6} class="rounded-lg bg-blue-600 px-5 py-2"><Text class="text-lg font-semibold text-white">+</Text></View>
      </View>
    </View>
  );
}
`;
  if (/chart|graph|bar|week/.test(p))
    return `import { Text, View } from "nsh";

const days = ["M", "T", "W", "T", "F", "S", "S"];
const vals = [42, 68, 35, 90, 74, 20, 55];

export default function R() {
  return (
    <View class="gap-2 py-2">
      <Text class="text-sm font-semibold text-zinc-800">Sessions this week</Text>
      <View class="h-32 flex-row items-end gap-2">
        <Each of={vals}>{(v, i) => (
          <View class="flex-1 items-center gap-1">
            <View class="w-full rounded-t-md bg-blue-500" style={{ height: v() }} />
            <Text class="text-[10px] text-zinc-500">{days[i()]}</Text>
          </View>
        )}
        </Each>
      </View>
    </View>
  );
}
`;
  if (/form|book|sign|input/.test(p))
    return `import { Input, signal, Text, View } from "nsh";

export default function R() {
  const name = signal("");
  const when = signal("");
  const sent = signal(false);
  return (
    <View class="gap-2 py-1">
      <Text class="text-sm font-semibold text-zinc-800">Book a table</Text>
      <Input value={name()} onChangeText={(t) => name.set(t)} placeholder="Name" class="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
      <Input value={when()} onChangeText={(t) => when.set(t)} placeholder="Friday, 8 pm" class="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
      <View onPress={() => sent.set(true)} activeOpacity={0.7} class="items-center rounded-lg bg-blue-600 py-2">
        <Text class="text-sm font-semibold text-white">Reserve</Text>
      </View>
      <If when={sent()}><Text class="text-xs text-green-600">Reserved for {name() || "—"}, {when() || "—"} ✓</Text></If>
    </View>
  );
}
`;
  if (/todo|task|check|list/.test(p))
    return `import { signal, Text, View } from "nsh";

const items0 = ["Ship nsh demo", "Write docs", "Test on iOS"];
const done = signal([false, false, false]);

export default function R() {
  return (
    <View class="gap-1 py-1">
      <Each of={items0}>{(t, i) => (
        <View onPress={() => done.update((d) => d.map((v, j) => (j === i() ? !v : v)))} activeOpacity={0.6} class="flex-row items-center gap-2 py-1">
          <View classList={{ "bg-blue-600 border-blue-600": done()[i()] }} class="h-4 w-4 rounded border border-zinc-400" />
          <Text classList={{ "line-through text-zinc-400": done()[i()] }} class="text-sm text-zinc-800">{t()}</Text>
        </View>
      )}
      </Each>
    </View>
  );
}
`;
  if (/stock|nvda|aapl|ticker|price/.test(p))
    return `import { Text, View } from "nsh";

export default function R() {
  return (
    <View class="gap-1 py-1">
      <View class="flex-row items-baseline justify-between">
        <Text class="text-base font-bold text-zinc-900">NVDA</Text>
        <Text class="text-base font-semibold text-green-600">▲ 8.6%</Text>
      </View>
      <Text class="text-3xl font-bold text-zinc-900">$186.42</Text>
      <Text class="text-xs text-zinc-500">NVIDIA Corp · close Fri · mock data</Text>
    </View>
  );
}
`;
  return `import { signal, Text, View } from "nsh";

export default function R() {
  const liked = signal(false);
  return (
    <View class="gap-2 py-1">
      <Text class="text-sm text-zinc-700">{${JSON.stringify(
        `You asked for: ${prompt}`,
      )}}</Text>
      <View onPress={() => liked.update((v) => !v)} activeOpacity={0.6} class="self-start rounded-lg bg-zinc-100 px-3 py-1.5">
        <Text class="text-sm">{liked() ? "♥ liked" : "♡ like"}</Text>
      </View>
    </View>
  );
}
`;
}

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.end();
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.setHeader("content-type", "text/plain");
    return res.end(
      `gen-server ok — ${store.list.length} threads, model=${MOCK ? "mock" : MODEL}\n`,
    );
  }
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { prompt } = JSON.parse(body || "{}");
        if (!prompt) throw new Error("missing prompt");
        const job = {
          id: nextJobId++,
          thread: store.active,
          seq: 0,
          phase: "queued",
          detail: "",
          done: false,
          result: null,
        };
        jobs.set(job.id, job);
        if (jobs.size > 25) jobs.delete(jobs.keys().next().value);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, id: job.id }));
        generate(job, prompt) // files land after the response; nsh dev hot-patches
          .catch((e) => {
            console.error(`✗ job ${job.id} crashed:`, e);
            job.done = true;
            setJob(job, "done", `generator error — ${e.message}`);
          });
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  if (req.method === "GET" && req.url === "/threads") {
    res.setHeader("content-type", "application/json");
    return res.end(
      JSON.stringify({
        active: activeThread().id,
        model: MOCK ? "mock" : MODEL,
        list: store.list.map((t) => ({
          id: t.id,
          title: t.title,
          count: t.turns.length,
        })),
      }),
    );
  }
  if (req.method === "POST" && req.url === "/thread/new") {
    const id = `t${threadSeq++}`;
    store.list.unshift({ id, title: "new chat", turns: [] });
    store.active = id;
    writeIndex();
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ ok: true, id }));
  }
  if (req.method === "POST" && req.url === "/thread/select") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { id } = JSON.parse(body || "{}");
        if (!store.list.some((t) => t.id === id))
          throw new Error(`unknown thread ${id}`);
        store.active = id;
        writeIndex();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/status")) {
    const id = Number(new URL(req.url, "http://x").searchParams.get("id"));
    const job = jobs.get(id);
    res.setHeader("content-type", "application/json");
    return res.end(
      jobJson(job || { id, seq: 0, phase: "unknown", detail: "", done: true }),
    );
  }
  if (req.method === "GET" && req.url.startsWith("/module")) {
    const name = new URL(req.url, "http://x").searchParams.get("name") || "";
    const file = [GEN_DIR, WIDGETS_DIR]
      .map((d) => join(d, `${name}.tsx`))
      .find(existsSync);
    res.setHeader("content-type", "application/json");
    return res.end(
      /^R\d+$/.test(name) && file
        ? JSON.stringify({ source: readFileSync(file, "utf8") })
        : JSON.stringify({ source: "" }),
    );
  }
  if (req.method === "POST" && req.url === "/copy") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { text } = JSON.parse(body || "{}");
        execFileSync("pbcopy", [], { input: String(text || "") });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/react") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { name, r } = JSON.parse(body || "{}");
        for (const t of store.list)
          for (const turn of t.turns)
            if (turn.role === "ai" && turn.name === name)
              turn.reaction = r || undefined;
        writeIndex();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/retry") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { name } = JSON.parse(body || "{}");
        let thread, prompt;
        for (const t of store.list) {
          const i = t.turns.findIndex(
            (x) => x.role === "ai" && x.name === name,
          );
          if (i < 0) continue;
          thread = t;
          for (let j = i - 1; j >= 0; j--)
            if (t.turns[j].role === "user") {
              prompt = t.turns[j].text;
              break;
            }
        }
        if (!thread || !prompt) throw new Error(`no prompt found for ${name}`);
        const job = {
          id: nextJobId++,
          thread: thread.id,
          retry: name,
          seq: 0,
          phase: "queued",
          detail: "",
          done: false,
          result: null,
        };
        jobs.set(job.id, job);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, id: job.id }));
        generate(job, prompt).catch((e) => {
          console.error(`✗ job ${job.id} crashed:`, e);
          job.done = true;
          setJob(job, "done", `generator error — ${e.message}`);
        });
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/share") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { name } = JSON.parse(body || "{}");
        const file = [GEN_DIR, WIDGETS_DIR]
          .map((d) => join(d, `${name}.tsx`))
          .find(existsSync);
        if (!/^R\d+$/.test(name) || !file)
          throw new Error(`no such module ${name}`);
        execFile("open", ["-R", file], () => {});
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/share/thread") {
    const thread = activeThread();
    const text = thread.turns
      .map((t) =>
        t.role === "user"
          ? `You: ${t.text}`
          : `Gen UI (${t.name}.tsx via ${t.label}):\n${
              existsSync(join(GEN_DIR, `${t.name}.tsx`))
                ? readFileSync(join(GEN_DIR, `${t.name}.tsx`), "utf8")
                : ""
            }`,
      )
      .join("\n\n");
    execFileSync("pbcopy", [], { input: text });
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ ok: true }));
  }
  // ————— publish / widgets shelf / persisted state —————
  if (req.method === "GET" && req.url === "/widgets") {
    res.setHeader("content-type", "application/json");
    return res.end(
      JSON.stringify(
        db
          .prepare("SELECT name,title,prompt,published_at FROM widgets ORDER BY published_at")
          .all(),
      ),
    );
  }
  if (req.method === "POST" && req.url === "/publish") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { name } = JSON.parse(body || "{}");
        const src = join(GEN_DIR, `${name}.tsx`);
        if (!/^R\d+$/.test(name) || !existsSync(src))
          throw new Error(`no such generated module ${name}`);
        // Title/prompt: the card's caption, else the user prompt before it.
        let title = "", prompt = "";
        for (const t of store.list) {
          const i = t.turns.findIndex((x) => x.role === "ai" && x.name === name);
          if (i < 0) continue;
          title = t.turns[i].caption || "";
          for (let j = i - 1; j >= 0; j--)
            if (t.turns[j].role === "user") {
              prompt = t.turns[j].text;
              break;
            }
          break;
        }
        if (!title || /error|implicit|rejected/i.test(title))
          title = prompt.slice(0, 48) || name;
        copyFileSync(src, join(WIDGETS_DIR, `${name}.tsx`));
        db.prepare(
          "INSERT OR REPLACE INTO widgets(name,title,prompt,published_at) VALUES(?,?,?,?)",
        ).run(name, title, prompt, new Date().toISOString());
        writeShelf();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, title }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/unpublish") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { name } = JSON.parse(body || "{}");
        db.prepare("DELETE FROM widgets WHERE name=?").run(name);
        // Rewrite the shelf FIRST (drops the import), then delete the file —
        // otherwise the watcher rebuilds the shelf with a dead import.
        writeShelf();
        setTimeout(() => {
          try {
            unlinkSync(join(WIDGETS_DIR, `${name}.tsx`));
          } catch {}
        }, 700);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/reuse") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { name } = JSON.parse(body || "{}");
        if (!widgetRow(name) || !existsSync(join(WIDGETS_DIR, `${name}.tsx`)))
          throw new Error(`no published widget ${name}`);
        activeThread().turns.push({
          role: "ai",
          name,
          label: "widget",
          caption: "",
          reaction: "",
          retries: 0,
          widget: true,
        });
        writeIndex();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  // Per-widget key-value state — one JSON blob per module name. Widgets load
  // it on mount and POST a fresh object whenever their state changes. Accepts
  // /state/<name>, /state?name=<name>, and bodies of {name,state} or the raw
  // state object.
  const stateName = () => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname.replace(/^\/state\/?/, "");
    return u.searchParams.get("name") || decodeURIComponent(p);
  };
  if (req.method === "GET" && req.url.startsWith("/state")) {
    const name = stateName();
    res.setHeader("content-type", "application/json");
    if (!/^[\w.-]+$/.test(name)) return res.end(JSON.stringify({ state: null }));
    const row = db.prepare("SELECT data FROM kv WHERE name=?").get(name);
    let state = null;
    try {
      state = row ? JSON.parse(row.data) : null;
    } catch {}
    console.log(`  /state GET ${name} → ${state ? "hit" : "empty"}`);
    return res.end(JSON.stringify({ state }));
  }
  if (req.method === "POST" && req.url.startsWith("/state")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        const name = stateName() || parsed.name;
        const state = parsed.state !== undefined ? parsed.state : parsed;
        if (!/^[\w.-]+$/.test(String(name || "")))
          throw new Error("bad module name");
        db.prepare("INSERT OR REPLACE INTO kv(name,data) VALUES(?,?)").run(
          name,
          JSON.stringify(state ?? {}),
        );
        console.log(`  /state POST ${name} → ${JSON.stringify(state)}`);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    });
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

persist(); // seed the DB on first boot / after a JSON→SQLite migration
writeShelf(); // sync widgets/index.tsx with the DB

server.listen(PORT, "127.0.0.1", () => {
  console.log(`gen-server on http://127.0.0.1:${PORT}`);
  console.log(
    MOCK ||
    !(PROVIDER === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENROUTER_API_KEY)
      ? "mode: MOCK (set ANTHROPIC_API_KEY or OPENROUTER_API_KEY for real generation)"
      : `mode: ${MODEL} via ${PROVIDER === "anthropic" ? "anthropic" : BASE_URL}`,
  );
});
