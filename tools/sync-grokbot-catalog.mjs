#!/usr/bin/env node
// sync-grokbot-catalog.mjs — snapshot Grok Bot's plugin catalog into
// server/plugins/grokbot-catalog.json and pre-resolve every entry to its
// plugin directory, MCP servers and skills.
//
//   node tools/sync-grokbot-catalog.mjs [--from catalog.json] [--port 9333]
//        [--cache <dir>] [--no-resolve] [--dist "<Grok Shell.app>"]
//
// Source: Grok Bot (Electron) running with --remote-debugging-port; its
// preload bridge exposes window.desktop.main.getMcpCatalog() (read-only).
// --from skips CDP and uses an earlier dump. Resolution makes blobless
// shallow clones of every repository under --cache (default
// ~/.cache/grok-shell/plugin-repos) and reads only manifests from them.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { repoOf, resolveEntry } from "../server/plugin_resolve.mjs";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "server/plugins/grokbot-catalog.json");
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const flag = (k) => process.argv.includes(`--${k}`);

// Entries Grok Bot lists from a user-added private marketplace carry no
// repository; these are those marketplaces' public homes. A guess only
// counts when the repo has a plugin of the entry's name.
const PRIVATE_MARKETPLACES = {
  "claude-community": "https://github.com/anthropics/claude-plugins-community",
  mattpocock: "https://github.com/mattpocock/skills",
  "claude-code-warp": "https://github.com/warpdotdev/claude-code-warp",
  "supabase-agent-skills": "https://github.com/supabase/agent-skills",
  "pua-skills": "https://github.com/tanweai/pua",
  "tavily-plugins": "https://github.com/tavily-ai/skills",
};

async function fromGrokBot(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error(`no Grok Bot page on CDP port ${port}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  const expression = "(async () => JSON.stringify(await window.desktop.main.getMcpCatalog()))()";
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  const value = await new Promise((r, j) =>
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== 1) return;
      const v = m.result?.result?.value;
      typeof v === "string" ? r(v) : j(new Error(JSON.stringify(m.result).slice(0, 300)));
    }),
  );
  ws.close();
  return JSON.parse(value);
}

const repoDir = (cache, url) => join(cache, url.replace(/^https:\/\/github\.com\//, "").replace(/\//g, "__"));

async function repoView(cache, url) {
  const dir = repoDir(cache, url);
  if (!existsSync(join(dir, ".git")))
    await run("git", ["clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout", url, dir], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: 180000,
    });
  const { stdout: sha } = await run("git", ["-C", dir, "rev-parse", "HEAD"]);
  const { stdout } = await run("git", ["-C", dir, "ls-tree", "-r", "--name-only", "HEAD"], { maxBuffer: 64 << 20 });
  const files = stdout.split("\n").filter(Boolean);
  const set = new Set(files);
  const memo = new Map();
  const read = (p) => {
    if (!set.has(p)) return Promise.resolve(null);
    if (!memo.has(p))
      memo.set(p, run("git", ["-C", dir, "show", `HEAD:${p}`], { maxBuffer: 16 << 20, timeout: 60000 }).then((r) => r.stdout, () => null));
    return memo.get(p);
  };
  return { files, read, sha: sha.trim() };
}

// Stable unique keys: the most popular entry keeps the bare name, the rest
// fall back to their pluginName, then name-id.
function assignKeys(entries) {
  const used = new Set();
  const order = [...entries].sort((a, b) => (a.popularityRank ?? 1e9) - (b.popularityRank ?? 1e9));
  for (const e of order) {
    const k = [e.name, e.pluginName, `${e.name}-${e.id}`].find((c) => c && !used.has(c));
    used.add(k);
    e.key = k;
  }
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j], j); }
  }));
  return out;
}

const from = arg("from");
const entries = from ? JSON.parse(readFileSync(from, "utf8")) : await fromGrokBot(Number(arg("port", 9333)));
if (!Array.isArray(entries) || !entries.length) throw new Error("catalog is empty");
assignKeys(entries);

if (!flag("no-resolve")) {
  const cache = arg("cache", join(homedir(), ".cache/grok-shell/plugin-repos"));
  mkdirSync(cache, { recursive: true });
  const views = new Map();
  const view = (url) => {
    if (!views.has(url)) views.set(url, repoView(cache, url).catch((e) => ({ error: String(e.message || e).split("\n")[0] })));
    return views.get(url);
  };
  await mapLimit(entries, 12, async (e) => {
    const guess = !repoOf(e) && PRIVATE_MARKETPLACES[e.marketplace?.name];
    const repo = repoOf(e) || guess;
    if (!repo) { e.install = { unavailable: "listed from a private marketplace with no public repository" }; return; }
    const v = await view(repo);
    if (v.error) { e.install = { repo, unavailable: `repository unreachable (${v.error.slice(0, 120)})` }; return; }
    const r = await resolveEntry(e, v);
    if (r.error || (guess && !["marketplace", "manifest"].includes(r.via))) {
      e.install = { repo, unavailable: guess ? `private marketplace "${e.marketplace.name}" — no matching plugin found in ${repo}` : r.error };
      return;
    }
    e.install = {
      repo, sha: v.sha, path: r.path, via: r.via,
      servers: r.mcpServers,
      skills: r.skills.map((s) => s.file),
      ...(r.missing.length ? { missingConnectors: r.missing } : {}),
    };
  });
}

entries.sort((a, b) => (a.popularityRank ?? 1e9) - (b.popularityRank ?? 1e9));
const snapshot = { source: "grok-bot", fetchedAt: new Date().toISOString(), count: entries.length, plugins: entries };
writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + "\n");
const dist = arg("dist", join(ROOT, "dist/Grok Shell.app"));
const distOut = join(dist, "Contents/Resources/server/plugins/grokbot-catalog.json");
if (existsSync(dirname(distOut))) copyFileSync(OUT, distOut);

// Coverage summary.
const s = { total: entries.length, installable: 0, withServers: 0, skillsOnly: 0, connectorOnly: 0, unavailable: 0, missingConnectors: 0 };
for (const e of entries) {
  const i = e.install;
  if (!i || i.unavailable) { s.unavailable++; continue; }
  s.installable++;
  const ns = Object.keys(i.servers || {}).length;
  if (ns) s.withServers++;
  if (!ns && i.skills.length) s.skillsOnly++;
  if (ns && !i.skills.length) s.connectorOnly++;
  if (i.missingConnectors) s.missingConnectors++;
}
console.log(JSON.stringify(s));
for (const e of entries.filter((e) => e.install?.unavailable)) console.log(`  unavailable ${e.key}: ${e.install.unavailable}`);
for (const e of entries.filter((e) => e.install?.missingConnectors)) console.log(`  missing ${e.key}: ${e.install.missingConnectors.join(",")} (${e.install.repo} ${e.install.path || "/"})`);
console.log(`wrote ${OUT}`);
