import {
  cleanup,
  effect,
  Input,
  mount,
  Scroll,
  signal,
  Text,
  View,
  type YNode,
} from "nsh";
import { appearance, bubbleColor, bubbleFill, nextTheme, tc, tg, themePref, type ThemePref } from "./theme";
import { isAvailable, Menu, titleBar, Window } from "nsh/desktop";
import { windowSize } from "nsh/device";
import { keymap } from "nsh/keymap";
import { Image } from "nsh/image";
import { PanResponder } from "nsh/gesture";
import { KeyboardAvoidingView, SafeAreaView } from "nsh/ui/mobile";
import { Animated, createAnimatedValue, Easing } from "nsh/animated";
import { BotAvatar, BotBlob, BOT_COLORS, BOT_SHAPES, blobEdit, blobGaze, CroppedImage, inkOf, normColor, SleepingBlob, type AvatarCrop, type BlobGaze } from "./blob";
import { Conversation } from "./shell";
import { loadModels, ModelPill, ModelPopover, type Choice } from "./modelpicker";
import { Palette, paletteOpen, type PaletteItem } from "./palette";
import { FileTile, type Attachment } from "./filetile";
import { FileViewer, viewing } from "./fileviewer";
import { Lightbox } from "./lightbox";
import { WidgetShelf } from "../widgets/index";
import { FxOverlay, morphKind, ShimmerText, StatusAvatar, STATES, statusLabel } from "./statusfx";

const GEN = "http://127.0.0.1:8787";

// generation phases → Grok's agent states
const PHASE_STATE: Record<string, string> = {
  thinking: "thinking",
  searching: "searching",
  browsing: "reading",
  reading: "reading",
  connecting: "orbit",
  writing: "writing",
  coding: "coding",
  generating: "progress",
  "running-commands": "running",
  "on-its-computer": "computing",
  "on-your-computer": "controlling",
  working: "working",
  messaging: "sending",
  sending: "sending",
  waiting: "waiting",
  queued: "working",
  tool: "working",
  streaming: "streaming",
  checking: "running",
  retrying: "writing",
  fallback: "working",
  publishing: "uploading",
};

const SUGGESTIONS = [
  "tetris with automatic gravity drawn on a Canvas",
  "a weather card for Manila with a 5-day forecast row",
  "a pomodoro timer with start, pause and reset",
  "a stock card for NVDA with a mini sparkline",
];

type BotMeta = {
  id: string;
  name: string;
  shape: string;
  color: string;
  threadId: string;
  pinned?: boolean;
  section?: string;
  hidden?: boolean;
  preview?: string;
  image?: string;
  crop?: AvatarCrop;
  model?: string;
  effort?: string;
  fast?: boolean;
};
type ThreadMeta = {
  id: string;
  title: string;
  count: number;
  lastApp: string;
  bot?: { id: string; name: string; shape: string; color: string } | null;
};
type DetailMeta = {
  name: string;
  title: string;
  kinds: string[];
  tags: string[];
  published: boolean;
  pinned: boolean;
};

const AVATAR_HUES = ["#1884fc", "#32bb78", "#f2994a", "#eb5757", "#9b51e0", "#2d9cdb", "#f2c94c"];
const hue = (s: string) =>
  AVATAR_HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_HUES.length];

function App() {
  const draft = signal("");
  const inflight = signal(0);
  // live agent runs, keyed by thread — Grok's status row: a mark playing
  // the ambient effect plus the shimmering label. Set by the generator's
  // phases while a run is in flight, or by /status:<state> to preview one
  // without a call. Per-thread so a run in one chat can't steal or clear
  // another's row (or stop its bot's sidebar animation).
  const agentRuns = signal<
    Record<string, { state: string; label: string; bot: string | null }>
  >({});
  const agent = () => agentRuns()[activeId()] ?? null;
  const agentSet = (
    thread: string,
    bot: string | null,
    v: { state: string; label: string } | null,
  ) =>
    agentRuns.update((m) => {
      const next = { ...m };
      if (v) next[thread] = { ...v, bot };
      else delete next[thread];
      return next;
    });
  const settled = signal<{ id: string; state: string } | null>(null);
  const emphBot = signal("");
  let settledTimer: ReturnType<typeof setTimeout> | null = null;
  const settle = (id: string, state: string) => {
    settled.set({ id, state });
    if (settledTimer) clearTimeout(settledTimer);
    settledTimer = setTimeout(() => {
      settled.set(null);
      settledTimer = null;
    }, 8000);
  };
  effect(() => {
    if (!agent()) emphBot.set("");
  });
  let mockTimer: ReturnType<typeof setInterval> | null = null;
  const mockStatus = (arg: string) => {
    if (mockTimer) { clearInterval(mockTimer); mockTimer = null; }
    const thread = activeId();
    const bot = activeBot()?.id ?? null;
    settled.set(null);
    if (!arg || arg === "off" || arg === "idle" || arg === "clear") {
      agentSet(thread, bot, null);
      return;
    }
    const put = (name: string, demo = false) => {
      const label = statusLabel(name) || name;
      agentSet(thread, bot, { state: name, label: demo ? `${name} — ${label}` : label });
    };
    if (arg === "demo") {
      const names = STATES.filter((name) => name !== "idle");
      let i = 0;
      put(names[0], true);
      mockTimer = setInterval(() => {
        if (++i >= names.length) {
          if (mockTimer) clearInterval(mockTimer);
          mockTimer = null;
          agentSet(thread, bot, null);
          return;
        }
        put(names[i], true);
      }, 1700);
      return;
    }
    if (STATES.includes(arg)) {
      put(arg);
    } else {
      agentSet(thread, bot, { state: "idle", label: `unknown status "${arg}" — try /status:demo` });
    }
  };
  // the floating composer's height: the transcript pads its end by it, so the
  // scroll view (and its scrollbar) runs to the window's bottom like Grok's
  const dockH = signal(96);
  const threads = signal<ThreadMeta[]>([]);
  let threadsJ = "";
  const bots = signal<BotMeta[]>([]);
  const sections = signal<string[]>([]);
  let botsJ = "";
  const botModal = signal(false); // "Create New Bot" sheet
  const botHover = signal(""); // its hovered control
  const botName = signal("");
  const botShape = signal("blob");
  const botColor = signal("#1084FE");
  // Grok `isFollowingPointer`: one gaze tracker per mark placement (the same
  // bot can show on rail, row and pin tiles at once — each tracks alone).
  const railGazes = new Map<string, BlobGaze>();
  const railGaze = (id: string) => {
    let g = railGazes.get(id);
    if (!g) railGazes.set(id, (g = blobGaze()));
    return g;
  };
  // Grok parity (extracted from its bundle): attachMarkHoverGaze listens on
  // the bot's container — row, tile or rail button — and computes gaze from
  // the mark's rect inside it: center of the avatar box, reach half its
  // width, each axis clamped ±1, y up positive. pointerleave resets to the
  // resting pose. onHoverMove gives container-local coords, so each site
  // passes its mark's own center + half-width as the reach.

  const panelGaze = blobGaze(); // right-panel editor blob
  const panelEditK = createAnimatedValue(0); // avatar hover → image avatars darken
  const panelEdit = blobEdit();            // avatar hover → blob darkens
  const avatarHover = signal(false);       // shows the "Edit Avatar" tooltip
  const avatarEditing = signal(false);     // click avatar → avatar editor pane
  const avatarEditTab = signal("bot");     // bot | generate | upload
  const avatarGenPrompt = signal("");
  const avatarGenBusy = signal(false);
  // Generate / Upload result awaiting "Set avatar": the image plus its crop
  type AvatarDraft = { uri: string; name: string; w: number; h: number };
  const genDraft = signal<AvatarDraft | null>(null);
  const upDraft = signal<AvatarDraft | null>(null);
  const draftCrop = signal<{ s: number; x: number; y: number }>({ s: 1, x: 0, y: 0 });
  const avatarErr = signal("");
  const threadApps = signal<{ name: string; title: string; file: string; subtitle: string; published: boolean; mtime: number }[]>([]);
  const activeId = signal("");
  const model = signal("…");
  const sideMode = signal("full"); // "full" | "rail"
  const sideShown = signal(true);
  const rightOpen = signal(true);
  const winW = () => windowSize().width;
  const sidePeek = signal(false); // flyout rail (unused while the user drives the sidebar)
  // The user drives the chrome: the sidebar toggle's left click shows/hides
  // the sidebar, its right click switches full ↔ mini; the pane opens and
  // closes from the title-bar pill (Grok), whatever the window width.
  const sideEff = (): string => (sideShown() ? sideMode() : "hidden");
  const toggleSide = () => sideShown.update((v) => !v);
  const toggleSideMode = () => {
    sideShown.set(true);
    sideMode.update((v) => (v === "full" ? "rail" : "full"));
  };
  const rightEff = () => rightOpen();
  // the full record (image, crop, sections…) lives in `bots`
  const activeBot = (): BotMeta | null => {
    const tb = threads().find((t) => t.id === activeId())?.bot;
    return tb ? (bots().find((b) => b.id === tb.id) ?? ({ ...tb, threadId: activeId() } as BotMeta)) : null;
  };
  effect(() => bubbleColor.set(activeBot() ? normColor(activeBot()!.color) : ""));
  // a bot's mark state (Grok's ng()): its run's activity while it runs, the
  // outcome for 8s after it settles, else idle — played by its sidebar mark
  // and the status row (Grok animates only those; header and pane are static)
  const botSt = (id: string) =>
    Object.values(agentRuns()).find((r) => r.bot === id)?.state ??
    (settled()?.id === id ? settled()!.state : "idle");
  // send: the bot's color; the white/black ink bot sends with the text color
  const neutralSend = () => !bubbleColor() || ["#FFFFFF", "#777777"].includes(bubbleColor().toUpperCase());
  const sendFill = () => (neutralSend() ? tc("#f5f5f5") : bubbleFill());
  const sendInk = () => (neutralSend() ? tc("#121212") : "#ffffff");
  const botEditName = signal("");
  effect(() => {
    botEditName.set(activeBot()?.name || "");
  });
  const updateBot = (
    id: string,
    patch: {
      name?: string; shape?: string; color?: string; pinned?: boolean; section?: string; hidden?: boolean;
      image?: string; crop?: AvatarCrop; model?: string; effort?: string; fast?: boolean;
    },
  ) => {
    // optimistic: reflect in sidebar/rails at once; poll confirms
    bots.set(bots().map((b) => (b.id === id ? { ...b, ...patch } : b)));
    threads.set(
      threads().map((t) =>
        t.bot?.id === id ? { ...t, bot: { ...t.bot, ...patch } } : t,
      ),
    );
    post("/bot/update", { id, ...patch });
  };
  const detailTab = signal("details"); // "details" | "state"
  const detail = signal<DetailMeta | null>(null);
  const detailState = signal<[string, string][]>([]);
  let detailFor = "";
  const tab = signal("chat");
  let scroller!: YNode;

  // Chat stays pinned to the bottom — instant snap, never a visible flythrough.
  const scrollToEnd = () =>
    setTimeout(() => scroller?.scrollToEnd({ animated: false }), 60);

  const turns = signal<any[]>([]);
  // Opening a thread: the transcript is built in one pass while invisible,
  // jumped to its end once laid out, then shown — it opens on the latest
  // message with no visible scrolling (no batches landing above the view).
  const revealed = signal(true);
  let pinned = true, turnsThread = "", lastScrollY = 0;
  // shown once the transcript's height holds still for a moment (diagrams
  // and highlighted code settle), at most 900ms after opening
  let settleTimer: any = null, openedAt = 0;
  const reveal = () => {
    console.log(`DBGS ${Date.now() % 100000} REVEAL scroller=${!!scroller}`);
    settleTimer = null;
    scroller?.scrollToEnd({ animated: false });
    revealed.set(true);
  };
  const settleSoon = () => {
    if (settleTimer) clearTimeout(settleTimer); // nsh's clearTimeout throws on undefined
    settleTimer = setTimeout(reveal, Math.max(0, Math.min(120, 900 - (Date.now() - openedAt))));
  };
  const openThread = () => {
    console.log(`DBGS ${Date.now() % 100000} OPEN`);
    pinned = true;
    openedAt = Date.now();
    revealed.set(false);
    settleSoon(); // also covers a thread whose layout never changes
  };
  let turnsJson_ = "";
  const seenTurns = { n: 0 };
  // <Each> keeps rows by object identity, and every /turns poll is fresh JSON:
  // reuse the previous object for each unchanged turn so only new or changed
  // rows are built (no re-decoded images, reloaded diagrams, reset players)
  let keep = new Map<string, any>();
  const stable = (list: any[]) => {
    const next = new Map<string, any>();
    const out = list.map((t) => {
      const k = JSON.stringify(t);
      const same = keep.get(k) ?? t;
      next.set(k, same);
      return same;
    });
    keep = next;
    return out;
  };
  const applyTurns = (list: any[]) => {
    const j = JSON.stringify(list);
    if (j === turnsJson_) return;
    turnsJson_ = j;
    const grew = list.length > seenTurns.n;
    seenTurns.n = list.length;
    turns.set(stable(list));
    if (grew) scrollToEnd();
  };
  const refreshTurns = async () => {
    const d = await fetch(`${GEN}/turns`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (d && d.active === activeId()) {
      if (d.active !== turnsThread) {
        turnsThread = d.active;
        seenTurns.n = d.turns.length;
        openThread();
      }
      applyTurns(d.turns);
    }
  };

  // the saved theme preference
  // the model choice: the active bot's, else the app-wide one (prefs)
  const prefChoice = signal<Choice>({ model: "", effort: "", fast: false });
  const choice = (): Choice => {
    const b = activeBot();
    return b ? { model: b.model || "", effort: b.effort || "", fast: !!b.fast } : prefChoice();
  };
  const setChoice = (c: Choice) => {
    const b = activeBot();
    if (b) updateBot(b.id, c);
    else {
      prefChoice.set(c);
      post("/prefs", c);
    }
  };
  loadModels();
  fetch(`${GEN}/prefs`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return;
      if (d.theme) themePref.set(d.theme as ThemePref);
      prefChoice.set({ model: d.model || "", effort: d.effort || "", fast: !!d.fast });
    })
    .catch(() => {});
  const refreshThreads = async () => {
    const d = await fetch(`${GEN}/threads`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (d) {
      // Only push a new array when the list actually changed — an unchanged
      // sidebar must not re-render every poll.
      const j = JSON.stringify(d.list);
      if (j !== threadsJ) {
        threadsJ = j;
        threads.set(d.list);
      }
      const bj = JSON.stringify(d.bots || []);
      if (bj !== botsJ) {
        botsJ = bj;
        bots.set(d.bots || []);
      }
      if (JSON.stringify(d.sections || []) !== JSON.stringify(sections()))
        sections.set(d.sections || []);
      activeId.set(d.active);
      model.set(d.model);
      const app = d.list.find((t: ThreadMeta) => t.id === d.active)?.lastApp || "";
      if (app !== detailFor) {
        detailFor = app;
        if (!app) {
          detail.set(null);
          detailState.set([]);
        } else {
          const cat = await fetch(`${GEN}/catalog`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          const item = cat?.list?.find((x: any) => x.name === app);
          detail.set(
            item
              ? {
                  name: item.name,
                  title: item.title,
                  kinds: item.kinds || [],
                  tags: item.tags || [],
                  published: true,
                  pinned: !!item.pinned,
                }
              : { name: app, title: app, kinds: [], tags: [], published: false, pinned: false },
          );
        }
      }
      if (app) {
        const st = await fetch(`${GEN}/state/${app}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const obj = st?.state;
        detailState.set(
          obj && typeof obj === "object"
            ? Object.entries(obj)
                .filter(([k]) => k !== "widget")
                .slice(0, 10)
                .map(([k, v]) => [
                  k,
                  typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v),
                ])
            : [],
        );
      }
    }
  };
  refreshThreads();
  refreshTurns();
  effect(() => {
    const t = setInterval(() => {
      refreshThreads();
      refreshTurns();
    }, 2500);
    cleanup(() => clearInterval(t));
  });

  // Grok composer state: the message being replied to, staged attachments
  type Attach = Attachment;
  const replyTo = signal<{ i: number; text: string; files?: string[] } | null>(null);
  const attachments = signal<Attach[]>([]);
  const attachHover = signal("");
  // Grok's + menu: a small card just above the button
  let plusBtn!: YNode;
  const plusMenu = signal<{ x: number; y: number } | null>(null);
  const plusHover = signal("");
  const paneBtnHover = signal(""); // right pane: theme / close hover plates
  // tall composer (Grok's two-tier): several lines, a long line, or a reply / attachments
  const rightW = signal(150);
  const composerTall = () =>
    draft().includes("\n") || draft().length > 64 || !!replyTo() || attachments().length > 0;
  const pickAttachments = async () => {
    const r = await post("/attach/pick");
    const d = r ? await r.json().catch(() => null) : null;
    if (d?.files?.length) attachments.set([...attachments(), ...d.files]);
  };
  // Grok's composer tooltips: 12pt on the elevated surface, above the button
  const composerTip = (text: string) => (
    <View
      style={{
        position: "absolute",
        bottom: 34,
        right: 0,
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderRadius: 6,
        backgroundColor: tc("#1f1f1f"),
        borderWidth: 0.5,
        borderColor: tc("#f5f5f51a"),
      }}
    >
      <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 12, lineHeight: 16 }}>{text}</Text>
    </View>
  );
  const run = async (prompt: string, extra: { reply?: { i: number; text: string } | null; attachments?: Attach[] } = {}) => {
    const bot = activeBot()?.id ?? "";
    const thread = activeId();
    inflight.update((n) => n + 1);
    settled.set(null);
    agentSet(thread, bot, { state: "working", label: statusLabel("working") });
    try {
      const r = await fetch(`${GEN}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, reply: extra.reply ?? undefined, attachments: extra.attachments?.length ? extra.attachments : undefined }),
      });
      if (!r.ok) throw new Error(`generator answered ${r.status}`);
      const { id } = await r.json();
      // poll this job until the pipeline finishes (think→write→check→publish)
      let detail = "";
      for (let fails = 0; ; ) {
        await new Promise((res) => setTimeout(res, 400));
        const s = await fetch(`${GEN}/status?id=${id}`)
          .then((x) => (x.ok ? x.json() : null))
          .catch(() => null);
        if (!s) {
          if (++fails > 15) throw new Error("lost the generator");
          continue;
        }
        fails = 0;
        const extra =
          inflight() > 1 ? ` · ${inflight()} generations running` : "";
        detail = s.detail || s.phase;
        agentSet(thread, bot, {
          state: PHASE_STATE[s.phase] ?? "working",
          label: `${detail}${extra}`,
        });
        if (s.done) break;
      }
      refreshThreads();
      agentSet(thread, bot, null);
      settle(bot, /^(failed|generator error)/.test(detail) ? "failed" : "finished");
    } catch (e) {
      agentSet(thread, bot, { state: "failed", label: `no generator — run  node server/app-server.mjs` });
      settle(bot, "failed");
      setTimeout(() => {
        const cur = agentRuns()[thread];
        if (cur?.state === "failed" && cur.label.startsWith("no generator"))
          agentSet(thread, bot, null);
      }, 5000);
    }
    inflight.update((n) => n - 1);
    scrollToEnd();
  };

  const send = () => {
    const prompt = draft().trim();
    const files = attachments();
    if (!prompt && !files.length) return;
    const reply = replyTo();
    draft.set("");
    replyTo.set(null);
    attachments.set([]);
    // /status:<state> previews the agent status row without a generation —
    // /status:demo cycles Grok's whole state table, /status:off clears.
    if (prompt === "/status" || prompt.startsWith("/status:")) {
      mockStatus(prompt === "/status" ? "demo" : prompt.slice(8).trim());
      return;
    }
    run(prompt, { reply, attachments: files });
  };

  const post = (path: string, body?: object) =>
    fetch(`${GEN}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);

  const newThread = async () => {
    await post("/thread/new");
    tab.set("chat");
    turnsJson_ = "";
    seenTurns.n = 0;
    turns.set([]);
    await refreshThreads();
  };
  const selectThread = async (id: string) => {
    console.log(`DBGS ${Date.now() % 100000} CLICK ${id}`);
    if (id === activeId()) return;
    tab.set("chat");
    activeId.set(id); // optimistic — highlight moves before the round-trip
    const r = await post("/thread/select", { id });
    const d = r?.ok ? await r.json().catch(() => null) : null;
    if (d?.turns) {
      // hide first: the new transcript must never paint at its top
      turnsThread = id;
      openThread();
      turnsJson_ = JSON.stringify(d.turns);
      seenTurns.n = d.turns.length;
      turns.set(stable(d.turns));
    }
    refreshThreads();
  };
  const createBot = async () => {
    const name = botName().trim();
    if (!name) return;
    botModal.set(false);
    const r = await post("/bot/new", {
      name,
      shape: botShape(),
      color: botColor(),
    });
    const d = r?.ok ? await r.json().catch(() => null) : null;
    if (d?.bot?.threadId) {
      activeId.set(d.bot.threadId);
      if (d.turns) {
        turnsJson_ = JSON.stringify(d.turns);
        seenTurns.n = d.turns.length;
        turns.set(stable(d.turns));
      }
    }
    botName.set("");
    refreshThreads();
  };
  const surprise = () =>
    draft.set(SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)]);

  // macOS: hide the system title bar and draw our own — the traffic lights
  // stay at their native spot; our strip is `titleBar().height` tall so our
  // controls sit level with them. Real app menu too.
  if (isAvailable) {
    Window.setTitle("Grok Shell");
    // a 44pt bar: the lights land at Grok's ~15pt inset instead of AppKit's
    // own (9pt in a 32pt bar — the row kept its tighter native spot)
    Window.setTitleBar("hidden", 44);
    Menu.setApplicationMenu([
      {
        label: "Grok Shell",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "showAll" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "File",
        submenu: [
          { label: "New Bot", shortcut: "mod+n", onSelect: () => botModal.set(true) },
          { label: "New Chat", onSelect: newThread },
          { type: "separator" },
          { role: "close" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Toggle Sidebar",
            shortcut: "mod+shift+s",
            onSelect: () => sideMode.update((v) => (v === "full" ? "rail" : "full")),
          },
          {
            label: "Toggle Details Panel",
            shortcut: "mod+shift+d",
            onSelect: () => rightOpen.update((v) => !v),
          },
          { type: "separator" },
          { role: "toggleFullScreen" },
        ],
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "zoom" }],
      },
    ]);
  }

  // Grok has no title bar strip: panes run to the top edge, the chat scrolls
  // under a gradient, and this much space at the top holds the controls.
  const TOP = 60;
  const pillHover = signal(false);
  const panelGlyph = (right: boolean) => (
    <View
      style={{
        width: 19,
        height: 15,
        borderRadius: 4.5,
        borderWidth: 1.5,
        borderColor: tc("#f5f5f585"),
        flexDirection: "row",
        justifyContent: right ? "flex-end" : "flex-start",
        overflow: "hidden",
      }}
    >
      <View style={{ width: 6.5, backgroundColor: tc("#f5f5f585") }} />
    </View>
  );
  const iconBtn = { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" } as const;
  const sideToggle = () => (
    <View onPress={toggleSide} onContextMenu={toggleSideMode} activeOpacity={0.7} accessibilityLabel="toggle sidebar" style={iconBtn}>
      {panelGlyph(false)}
    </View>
  );
  // ————— Grok's left sidebar (measured over CDP from Grok Bot) —————
  // full 240 / rail 88; rows 54 (pad 8, radius 10, gap 8, avatar box 36);
  // name 14/20 medium, subtitle 13/18 at 66% white, both one line with an
  // ellipsis; section headers 30 tall, 12/16 at 66%; pinned tiles 95×92.
  const SIDE_W = 240;
  const RAIL_W = 88;
  const dim = () => tc("#f5f5f5a8");
  const collapsedSecs = signal<Record<string, boolean>>({ __hidden: true });
  const toggleSec = (k: string) => collapsedSecs.update((m) => ({ ...m, [k]: !m[k] }));
  const hoverSec = signal("");
  const railPop = signal<{ bot: BotMeta; cy: number; x: number } | null>(null);
  const sectionPrompt = signal<string | null>(null);
  const sectionName = signal("");
  const pinnedBots = () => bots().filter((b) => b.pinned && !b.hidden);
  const hiddenBots = () => bots().filter((b) => b.hidden);
  const botGroups = () => {
    const vis = bots().filter((b) => !b.hidden && !b.pinned);
    const known = new Set(sections());
    const named = sections()
      .map((n) => ({ key: n, title: n, items: vis.filter((b) => b.section === n) }))
      .filter((g) => g.items.length);
    const un = vis.filter((b) => !b.section || !known.has(b.section));
    return un.length ? [...named, { key: "__un", title: "Unassigned", items: un }] : named;
  };
  const chats = () => threads().filter((t) => !t.bot);
  effect(() => {
    if (!viewing()) return;
    const off = keymap.bind("escape", () => viewing.set(null));
    cleanup(off);
  });
  // ————— keyboard shortcuts (mod = ⌘ on macOS, Ctrl on Windows / Linux) —————
  // the bots in sidebar order: pinned, then sections, then Unassigned
  const sidebarBots = () => [...pinnedBots(), ...botGroups().flatMap((g) => g.items)];
  const setTheme = (t: ThemePref) => {
    themePref.set(t);
    post("/prefs", { theme: t });
  };
  const miniApps = signal<{ name: string; title: string; prompt?: string }[]>([]);
  effect(() => {
    if (!paletteOpen()) return;
    fetch(`${GEN}/widgets`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => miniApps.set(Array.isArray(list) ? list : []))
      .catch(() => {});
  });
  // Grok's palette actions we can run today; Mini apps listed after them
  const paletteItems = (): PaletteItem[] => [
    { id: "new-bot", title: "New Bot", icon: "＋", run: () => botModal.set(true) },
    { id: "theme-system", title: "Theme: System", subtitle: "Settings · Appearance", icon: "◐", checked: themePref() === "system", run: () => setTheme("system") },
    { id: "theme-light", title: "Theme: Light", subtitle: "Settings · Appearance", icon: "☀︎", checked: themePref() === "light", run: () => setTheme("light") },
    { id: "theme-dark", title: "Theme: Dark", subtitle: "Settings · Appearance", icon: "☾", checked: themePref() === "dark", run: () => setTheme("dark") },
    ...miniApps().map((w: { name: string; title: string; prompt?: string }) => ({
      id: "app-" + w.name,
      // titles saved from a failed first compile read as errors: use the prompt
      title: (/error|implicit|annotat|module now/i.test(w.title || "") ? w.prompt || w.name : w.title || w.name)
        .replace(/[*_`#]/g, "")
        .trim(),
      subtitle: "Mini app",
      icon: "▦",
      run: () => post("/popout", { name: w.name }),
    })),
  ];
  {
    const off = keymap.bind({
      "mod+k": () => paletteOpen.set(!paletteOpen()),
      "mod+b": toggleSide,
      "mod+shift+h": toggleSideMode,
      "mod+shift+b": () => rightOpen.update((v) => !v),
      "mod+t": () => setTheme(nextTheme(themePref())),
      "mod+n": () => botModal.set(true),
      "mod+shift+m": () => tab.set(tab() === "work" ? "chat" : "work"),
      "mod+d": () => {
        agentSet(activeId(), activeBot()?.id ?? null, { state: "dictating", label: "Dictation is coming soon" });
        setTimeout(() => {
          if (agent()?.label === "Dictation is coming soon")
            agentSet(activeId(), activeBot()?.id ?? null, null);
        }, 2400);
      },
      ...Object.fromEntries(
        Array.from({ length: 9 }, (_, k) => [
          `mod+${k + 1}`,
          () => {
            const b = sidebarBots()[k];
            if (b) selectThread(b.threadId);
          },
        ]),
      ),
    });
    cleanup(off);
  }
  const moveToSection = (id: string, name: string) => {
    if (name && !sections().includes(name)) sections.set([...sections(), name]);
    updateBot(id, { section: name, pinned: false });
  };
  const deleteBot = async (b: BotMeta) => {
    await post("/bot/delete", { id: b.id });
    await refreshThreads();
    refreshTurns();
  };
  const botMenu = (b: BotMeta) =>
    Menu.popup([
      { label: b.pinned ? "Unpin" : "Pin", onSelect: () => updateBot(b.id, { pinned: !b.pinned }) },
      {
        label: "Move to section",
        submenu: [
          ...sections().map((n) => ({ label: n, onSelect: () => moveToSection(b.id, n) })),
          { label: "Unassigned", onSelect: () => moveToSection(b.id, "") },
          { type: "separator" as const },
          {
            label: "Move to new section",
            onSelect: () => {
              sectionName.set("");
              sectionPrompt.set(b.id);
            },
          },
        ],
      },
      { type: "separator" },
      {
        label: b.hidden ? "Show in sidebar" : "Hide from sidebar",
        onSelect: () => updateBot(b.id, { hidden: !b.hidden }),
      },
      { type: "separator" },
      { label: "Delete Bot", onSelect: () => deleteBot(b) },
    ]);
  const newMenu = () =>
    Menu.popup([
      { label: "New bot", onSelect: () => botModal.set(true) },
      { label: "New chat", onSelect: newThread },
    ]);
  const circleBtn = () => ({
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tc("#1f1f1f"),
    alignItems: "center",
    justifyContent: "center",
  }) as const;
  const gridGlyph = (sz: number) => (
    <View style={{ width: sz, height: sz, flexDirection: "row", flexWrap: "wrap", gap: sz * 0.2 }}>
      <View style={{ width: sz * 0.4, height: sz * 0.4, borderRadius: 1.5, backgroundColor: dim() }} />
      <View style={{ width: sz * 0.4, height: sz * 0.4, borderRadius: 1.5, backgroundColor: dim() }} />
      <View style={{ width: sz * 0.4, height: sz * 0.4, borderRadius: 1.5, backgroundColor: dim() }} />
      <View style={{ width: sz * 0.4, height: sz * 0.4, borderRadius: 1.5, backgroundColor: dim() }} />
    </View>
  );
  const secHeader = (key: string, title: string, count?: () => number) => (
    <View
      onPress={() => toggleSec(key)}
      onHoverIn={() => hoverSec.set(key)}
      onHoverOut={() => hoverSec() === key && hoverSec.set("")}
      activeOpacity={0.7}
      style={{
        height: 30,
        flexDirection: "row",
        alignItems: "center",
        paddingTop: 8,
        paddingBottom: 6,
        paddingHorizontal: 8,
        borderRadius: 6,
        backgroundColor: hoverSec() === key ? tc("#f5f5f50f") : "transparent",
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, color: dim(), fontSize: 12, lineHeight: 16 }}>
        {title}
      </Text>
      <If when={!!count}>
        <Text style={{ color: dim(), fontSize: 12, lineHeight: 16, marginLeft: 6 }}>{count?.()}</Text>
      </If>
      <If when={hoverSec() === key}>
        <Text
          style={{
            color: dim(),
            fontSize: 13,
            lineHeight: 16,
            marginLeft: 6,
            transform: [{ rotate: collapsedSecs()[key] ? "0deg" : "90deg" }],
          }}
        >
          ›
        </Text>
      </If>
    </View>
  );
  const rowBase = (active: boolean) =>
    ({
      height: 54,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 8,
      borderRadius: 10,
      backgroundColor: active ? tc("#f5f5f514") : "transparent",
    }) as const;
  const rowText = (title: string, sub: string) => (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 14, lineHeight: 20, fontWeight: "500" }}>
        {title}
      </Text>
      <Text numberOfLines={1} style={{ color: dim(), fontSize: 13, lineHeight: 18 }}>
        {sub}
      </Text>
    </View>
  );
  const botRow = (b: () => BotMeta) => (
    <View
      onPress={() => selectThread(b().threadId)}
      onContextMenu={() => botMenu(b())}
      onHoverMove={(e) => railGaze(b().id + ":row").follow(e, 26, 27, 18)}
      onHoverOut={() => railGaze(b().id + ":row").rest()}
      activeOpacity={0.7}
      accessibilityLabel={b().name}
      style={rowBase(b().threadId === activeId())}
    >
      <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
        <BotAvatar
          shape={b().shape}
          color={b().color}
          image={b().image}
          crop={b().crop}
          size={44}
          box={36}
          gaze={railGaze(b().id + ":row")}
          state={botSt(b().id)}
          emphasized={emphBot() === b().id}
          seed={b().id}
        />
        <If when={!!b().image && morphKind(botSt(b().id)) !== "none"}>
          <FxOverlay fx={morphKind(botSt(b().id))} size={36} />
        </If>
      </View>
      {rowText(b().name, b().preview || "No messages yet")}
    </View>
  );
  const chatRow = (t: () => ThreadMeta) => (
    <View
      onPress={() => selectThread(t().id)}
      activeOpacity={0.7}
      accessibilityLabel={t().title}
      style={rowBase(t().id === activeId())}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: hue(t().title),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
          {(t().title || "?").slice(0, 1).toUpperCase()}
        </Text>
      </View>
      {rowText(t().title, `${t().count} messages`)}
    </View>
  );
  const pinTile = (b: () => BotMeta) => {
    let node!: YNode;
    return (
    <View
      ref={node}
      onPress={() => selectThread(b().threadId)}
      onContextMenu={() => botMenu(b())}
      onHoverMove={(e) => railGaze(b().id + ":pin").follow(e, 47.5, 36, 30)}
      onHoverIn={async () => {
        const seq = ++popSeq;
        const m = await node?.measure();
        if (m && seq === popSeq) railPop.set({ bot: b(), cy: m.pageY + m.height / 2, x: m.pageX + m.width + 6 });
      }}
      onHoverOut={() => {
        popSeq++;
        railPop.set(null);
        railGaze(b().id + ":pin").rest();
      }}
      activeOpacity={0.7}
      accessibilityLabel={b().name}
      style={{
        width: 95,
        height: 92,
        borderRadius: 10,
        paddingTop: 6,
        paddingHorizontal: 8,
        paddingBottom: 4,
        gap: 6,
        alignItems: "center",
        // Grok: no plate until active (bg-active), like its rows
        backgroundColor: b().threadId === activeId() ? tc("#f5f5f514") : "transparent",
      }}
    >
      <View style={{ width: 60, height: 60, alignItems: "center", justifyContent: "center" }}>
        <BotAvatar
          shape={b().shape}
          color={b().color}
          image={b().image}
          crop={b().crop}
          size={72}
          box={60}
          gaze={railGaze(b().id + ":pin")}
          state={botSt(b().id)}
          emphasized={emphBot() === b().id}
          seed={b().id}
        />
        <If when={!!b().image && morphKind(botSt(b().id)) !== "none"}>
          <FxOverlay fx={morphKind(botSt(b().id))} size={60} />
        </If>
      </View>
      <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 12, lineHeight: 16, maxWidth: 79 }}>
        {b().name}
      </Text>
    </View>
    );
  };
  // rail: 54×54 buttons (pad 9, radius 10) with 36 avatars, 0.5px rules
  // between groups, and a popover (name + 2-line preview) on hover
  let popSeq = 0;
  // Grok's rail: every button (avatars, toggle, +, Mini Apps, account) shares
  // one rounded hover plate, so hovering feels uniform down the column
  const railHover = signal("");
  const railPlate = (key: string, h = 54, active = false) => ({
    width: 54,
    height: h,
    borderRadius: 10,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: active ? tc("#f5f5f514") : railHover() === key ? tc("#f5f5f50f") : "transparent",
  });
  const railHov = (key: string) => ({
    onHoverIn: () => railHover.set(key),
    onHoverOut: () => railHover() === key && railHover.set(""),
  });
  const railBtn = (b: () => BotMeta, flyout: boolean) => {
    let node!: YNode;
    return (
      <View
        ref={node}
        onPress={() => {
          selectThread(b().threadId);
          if (flyout) sidePeek.set(false);
        }}
        onContextMenu={() => botMenu(b())}
        onHoverIn={async () => {
          railHover.set("bot:" + b().id);
          const seq = ++popSeq;
          const m = await node?.measure();
          if (m && seq === popSeq) railPop.set({ bot: b(), cy: m.pageY + m.height / 2, x: m.pageX + m.width + 6 });
        }}
        onHoverOut={() => {
          popSeq++;
          railPop.set(null);
          if (railHover() === "bot:" + b().id) railHover.set("");
          railGaze(b().id + ":rail").rest();
        }}
        onHoverMove={(e) => railGaze(b().id + ":rail").follow(e, 27, 27, 18)}
        activeOpacity={0.7}
        accessibilityLabel={b().name}
        style={railPlate("bot:" + b().id, 54, b().threadId === activeId())}
      >
        <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
          <BotAvatar
            shape={b().shape}
            color={b().color}
            image={b().image}
            crop={b().crop}
            size={44}
            box={36}
            gaze={railGaze(b().id + ":rail")}
            state={botSt(b().id)}
            emphasized={emphBot() === b().id}
            seed={b().id}
          />
          <If when={!!b().image && morphKind(botSt(b().id)) !== "none"}>
            <FxOverlay fx={morphKind(botSt(b().id))} size={36} />
          </If>
        </View>
      </View>
    );
  };
  const railRule = () => (
    <View style={{ width: 54, height: 0.5, backgroundColor: tc("#f5f5f51a"), marginVertical: 6 }} />
  );
  // ————— right pane pieces (Grok's info pane) —————
  const paneLabel = (t: string) => (
    <Text style={{ color: dim(), fontSize: 13, lineHeight: 18, paddingHorizontal: 12, paddingBottom: 10 }}>{t}</Text>
  );
  const paneCard = () => ({
    backgroundColor: tc("#1f1f1f"),
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: tc("#f5f5f50f"),
    padding: 4,
  }) as const;
  // 32×20 switch, #116DD2 when on, a 16pt knob
  const paneSwitch = (on: boolean, toggle: () => void, label: string) => (
    <View
      onPress={toggle}
      activeOpacity={0.8}
      accessibilityRole="switch"
      accessibilityLabel={label}
      style={{
        width: 32,
        height: 20,
        borderRadius: 10,
        padding: 2,
        backgroundColor: on ? "#116DD2" : tc("#f5f5f52e"),
        alignItems: on ? "flex-end" : "flex-start",
      }}
    >
      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: tc("#f5f5f5") }} />
    </View>
  );
  const ago = (ms: number) => {
    if (!ms) return "";
    const m = (Date.now() - ms) / 60000;
    if (m < 60) return `${Math.max(1, Math.round(m))}m`;
    if (m < 1440) return `${Math.round(m / 60)}h`;
    return `${Math.round(m / 1440)}d`;
  };
  const libraryGroups = () => {
    const day = 864e5, now = Date.now();
    const g: { label: string; items: typeof threadApps extends () => infer T ? T : never }[] = [
      { label: "Today", items: [] },
      { label: "This week", items: [] },
      { label: "Older", items: [] },
    ];
    for (const a of threadApps()) g[now - a.mtime < day ? 0 : now - a.mtime < 7 * day ? 1 : 2].items.push(a);
    return g.filter((x) => x.items.length);
  };
  const fetchThreadApps = async () => {
    const d = await fetch(`${GEN}/thread/apps?thread=${encodeURIComponent(activeId())}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const next = d?.apps || [];
    if (JSON.stringify(next) !== JSON.stringify(threadApps())) threadApps.set(next);
  };
  effect(() => {
    activeId();
    threads();
    if (rightEff()) fetchThreadApps();
  });
  // Library renames land in the server's apps table — the title is a label
  // and the file name is display-only (the module stays R<n>.tsx on disk).
  const appRename = signal<{ name: string; field: "title" | "file" } | null>(null);
  const appRenameText = signal("");
  const appMenu = (a: { name: string; title: string; file: string }) =>
    Menu.popup([
      { label: "Rename Title…", onSelect: () => { appRenameText.set(a.title); appRename.set({ name: a.name, field: "title" }); } },
      { label: "Rename File Name…", onSelect: () => { appRenameText.set(a.file); appRename.set({ name: a.name, field: "file" }); } },
    ]);
  const saveAppRename = async () => {
    const r = appRename();
    const v = appRenameText().trim();
    appRename.set(null);
    if (!r || !v) return;
    await post("/app/meta", r.field === "title" ? { name: r.name, title: v } : { name: r.name, file: v });
    fetchThreadApps();
  };
  const openAvatarEditor = () => {
    avatarHover.set(false);
    panelEditK.timing(0, { duration: 200 });
    panelEdit.to(0);
    avatarErr.set("");
    avatarEditing.set(true);
  };
  const closeAvatarEditor = () => {
    avatarEditing.set(false);
    genDraft.set(null);
    upDraft.set(null);
    avatarGenBusy.set(false);
    avatarErr.set("");
  };
  // older stored palette values → the swatches Grok renders
  const sameColor = (a: string, b: string) => normColor(a) === normColor(b);
  const genPulse = createAnimatedValue(0);
  effect(() => {
    if (!avatarGenBusy()) return;
    const ease = Easing.bezier(0.42, 0, 0.58, 1);
    const l = Animated.loop(Animated.sequence([
      Animated.timing(genPulse, { toValue: 1, duration: 700, easing: ease }),
      Animated.timing(genPulse, { toValue: 0, duration: 700, easing: ease }),
    ]));
    l.start();
    cleanup(() => l.stop());
  });
  const takeDraft = (d: any, into: typeof genDraft) => {
    draftCrop.set({ s: 1, x: 0, y: 0 });
    into.set({ uri: d.uri, name: d.name, w: d.w, h: d.h });
  };
  const generateAvatar = async () => {
    const d = avatarGenPrompt().trim();
    if (!d || avatarGenBusy()) return;
    avatarErr.set("");
    avatarGenBusy.set(true);
    try {
      const r = await post("/avatar/image/gen", { description: d });
      const j = r ? await r.json() : null;
      if (j?.ok) takeDraft(j, genDraft);
      else avatarErr.set(j?.error || "Couldn't generate an avatar");
    } catch (e) {
      avatarErr.set(String(e));
    }
    avatarGenBusy.set(false);
  };
  const pickAvatar = async (kind: "pick" | "paste") => {
    avatarErr.set("");
    const r = await post(`/avatar/image/${kind}`);
    const j = r ? await r.json().catch(() => null) : null;
    if (j?.ok) takeDraft(j, upDraft);
    else if (!j?.cancelled) avatarErr.set(kind === "paste" ? "No image on the clipboard" : j?.error || "Couldn't open that image");
  };
  effect(() => {
    if (!avatarEditing()) return;
    const offs = [keymap.bind("escape", closeAvatarEditor)];
    if (avatarEditTab() === "upload" && !upDraft()) offs.push(keymap.bind("mod+v", () => pickAvatar("paste")));
    cleanup(() => offs.forEach((f) => f()));
  });
  // the round crop: drag to reposition, a 1×–3× zoom slider, Restart / Set avatar
  const CROP = 84, TRACK = 236;
  const clampCrop = (c: { s: number; x: number; y: number }) => {
    const lim = (c.s - 1) / 2;
    return { s: c.s, x: Math.max(-lim, Math.min(lim, c.x)), y: Math.max(-lim, Math.min(lim, c.y)) };
  };
  let dragFrom = { s: 1, x: 0, y: 0 };
  const imgPan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => (dragFrom = draftCrop()),
    onPanResponderMove: (_e, g) =>
      draftCrop.set(clampCrop({ ...dragFrom, x: dragFrom.x + g.dx / CROP, y: dragFrom.y + g.dy / CROP })),
  });
  const zoomPan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => (dragFrom = draftCrop()),
    onPanResponderMove: (_e, g) =>
      draftCrop.set(clampCrop({ ...dragFrom, s: Math.max(1, Math.min(3, dragFrom.s + (g.dx / TRACK) * 2)) })),
  });
  const zoomBy = (d: number) => draftCrop.set(clampCrop({ ...draftCrop(), s: Math.max(1, Math.min(3, draftCrop().s + d)) }));
  const cropEditor = (d: AvatarDraft, showName: boolean, restart: () => void) => (
    <View style={{ gap: 12 }}>
      <View style={{ alignItems: "center", gap: 6 }}>
        <View {...imgPan.panHandlers}>
          <CroppedImage uri={d.uri} size={CROP} crop={draftCrop()} />
        </View>
        <If when={showName}>
          <Text style={{ color: dim(), fontSize: 13, lineHeight: 18, textAlign: "center", paddingHorizontal: 8, marginTop: 6 }}>
            {`${d.name} · ${d.w}×${d.h}`}
          </Text>
        </If>
        <Text style={{ color: tc("#f5f5f58a"), fontSize: 13, lineHeight: 18, marginTop: showName ? 0 : 6 }}>Drag to reposition</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View onPress={() => zoomBy(-0.25)} activeOpacity={0.6} accessibilityLabel="Zoom out" style={{ width: 14, alignItems: "center" }}>
          <Text style={{ color: dim(), fontSize: 15 }}>−</Text>
        </View>
        <View {...zoomPan.panHandlers} style={{ width: TRACK, height: 20, justifyContent: "center" }}>
          <View style={{ height: 3, borderRadius: 1.5, backgroundColor: tc("#f5f5f51f") }} />
          <View
            style={{
              position: "absolute",
              left: ((draftCrop().s - 1) / 2) * (TRACK - 14),
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: tc("#f5f5f5"),
            }}
          />
        </View>
        <View onPress={() => zoomBy(0.25)} activeOpacity={0.6} accessibilityLabel="Zoom in" style={{ width: 14, alignItems: "center" }}>
          <Text style={{ color: dim(), fontSize: 15 }}>+</Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View
          onPress={() => {
            draftCrop.set({ s: 1, x: 0, y: 0 });
            restart();
          }}
          activeOpacity={0.7}
          style={{ flex: 1, height: 30, borderRadius: 10, backgroundColor: tc("#f5f5f50f"), alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: tc("#f5f5f5"), fontSize: 13, lineHeight: 18 }}>Restart</Text>
        </View>
        <View
          onPress={() => {
            updateBot(activeBot()!.id, { image: d.uri, crop: draftCrop() });
            closeAvatarEditor();
          }}
          activeOpacity={0.8}
          style={{ flex: 1, height: 30, borderRadius: 10, backgroundColor: tc("#f5f5f5"), alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: tc("#121212"), fontSize: 13, lineHeight: 18 }}>Set avatar</Text>
        </View>
      </View>
    </View>
  );
  // Grok's diffused edges: content blurs (Gaussian, via backdrop-filter) and
  // fades as it scrolls under the window controls or above the footer
  // A fade in the sidebar's own color only: nsh's backdropFilter is an
  // NSVisualEffectView, whose material tints what's behind it, so it showed
  // the edges as differently colored sections.
  const blurEdge = (edge: "top" | "bottom", h: number) => (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, [edge]: 0, height: h, zIndex: 2 }}>
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        [edge]: 0,
        height: h,
        // exactly the sidebar's own color (tc("#0e0e0e"): #0e0e0e / #f5f5f5),
        // so the strip melts into it instead of showing as a band
        backgroundImage: (() => {
          const c = appearance() === "dark" ? "14,14,14" : "245,245,245";
          return edge === "top"
            ? `linear-gradient(rgba(${c},0.94), rgba(${c},0.6) 60%, rgba(${c},0))`
            : `linear-gradient(rgba(${c},0), rgba(${c},0.6) 40%, rgba(${c},0.94))`;
        })(),
      }}
    />
    </View>
  );
  const railView = (flyout: boolean) => (
    <View
      style={{
        width: RAIL_W,
        backgroundColor: tc("#0e0e0e"),
        borderRightWidth: 0.5,
        borderRightColor: tc("#f5f5f50f"),
        paddingBottom: 8,
      }}
    >
      <View style={{ flex: 1 }}>
      <Scroll style={{ flex: 1 }} contentContainerStyle={{ alignItems: "center", gap: 4, paddingTop: 44 + 54 + 4, paddingBottom: 28 }}>
        <Each of={pinnedBots()}>{(b) => railBtn(b, flyout)}</Each>
        <Each of={botGroups()}>
          {(g, i) => (
            <View style={{ alignItems: "center", gap: 4 }}>
              <If when={i() > 0 || pinnedBots().length > 0}>{railRule()}</If>
              <Each of={g().items}>{(b) => railBtn(b, flyout)}</Each>
            </View>
          )}
        </Each>
        <If when={chats().length > 0}>
          <View style={{ alignItems: "center", gap: 4 }}>
          {railRule()}
          <Each of={chats().slice(0, 12)}>
            {(t) => (
              <View
                onPress={() => {
                  selectThread(t().id);
                  if (flyout) sidePeek.set(false);
                }}
                activeOpacity={0.7}
                accessibilityLabel={t().title}
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: t().id === activeId() ? tc("#f5f5f514") : "transparent",
                }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: hue(t().title),
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>
                    {(t().title || "?").slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              </View>
            )}
          </Each>
          </View>
        </If>
      </Scroll>
      {blurEdge("top", 44 + 54 + 6)}
      {blurEdge("bottom", 28)}
      {/* window-drag strip under the traffic lights, then the sidebar toggle (Grok's rail) */}
      <View desktop={{ windowDrag: true }} style={{ position: "absolute", top: 0, left: 0, right: 0, height: 44, zIndex: 3 }} />
      <View style={{ position: "absolute", top: 44, left: 0, right: 0, height: 54, alignItems: "center", justifyContent: "center", zIndex: 3 }}>
        <View onPress={toggleSide} onContextMenu={toggleSideMode} {...railHov("toggle")} activeOpacity={0.7} accessibilityLabel="toggle sidebar" style={railPlate("toggle", 44)}>
          {panelGlyph(false)}
        </View>
      </View>
      </View>
      <View style={{ alignItems: "center", gap: 2, paddingTop: 6 }}>
        <View onPress={newMenu} {...railHov("new")} activeOpacity={0.7} accessibilityLabel="New Bot" style={railPlate("new", 36)}>
          <Text style={{ color: dim(), fontSize: 18 }}>＋</Text>
        </View>
        <View onPress={() => tab.set(tab() === "work" ? "chat" : "work")} {...railHov("apps")} activeOpacity={0.7} accessibilityLabel="Mini Apps" style={railPlate("apps", 36, tab() === "work")}>
          {gridGlyph(14)}
        </View>
        <View {...railHov("account")} style={railPlate("account")}>
          <View style={{ ...circleBtn(), backgroundColor: tc("#1f1f1f") }}>
            <Text style={{ color: dim(), fontSize: 14, fontWeight: "500" }}>UI</Text>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc("#121212") }}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1, flexDirection: "row" }}>
        {/* ————— mini rail: icon column when the full sidebar is tucked away ————— */}
        <If when={sideEff() === "rail"}>{railView(false)}</If>

        {/* ————— sidebar (Grok: 240 wide, pinned tiles, named sections, Unassigned, Hidden) ————— */}
        <If when={sideEff() === "full"}>
        <View
          style={{
            width: SIDE_W,
            backgroundColor: tc("#0e0e0e"),
            borderRightWidth: 0.5,
            borderRightColor: tc("#f5f5f50f"),
          }}
        >
          {/* top: traffic lights at the left; round controls at the right —
              floating over the list, which blurs as it scrolls under */}
          <View
            desktop={{ windowDrag: true }}
            style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 3, height: TOP, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingRight: 16 }}
          >
            <View onPress={toggleSide} onContextMenu={toggleSideMode} activeOpacity={0.7} accessibilityLabel="toggle sidebar" style={circleBtn()}>
              {panelGlyph(false)}
            </View>
            <View onPress={newMenu} activeOpacity={0.7} accessibilityLabel="New Bot" style={circleBtn()}>
              <Text style={{ color: tc("#f5f5f5"), fontSize: 19, lineHeight: 22 }}>＋</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
          {blurEdge("top", TOP)}
          {blurEdge("bottom", 28)}
          <Scroll style={{ flex: 1 }} contentContainerStyle={{ paddingTop: TOP + 4, paddingHorizontal: 12, paddingBottom: 32, gap: 10 }}>
            <If when={pinnedBots().length > 0}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, paddingTop: 6, paddingBottom: 8 }}>
                <Each of={pinnedBots()}>{(b) => pinTile(b)}</Each>
              </View>
            </If>
            <Each of={botGroups()}>
              {(g) => (
                <View>
                  {secHeader(g().key, g().title)}
                  <If when={!collapsedSecs()[g().key]}>
                    <Each of={g().items}>{(b) => botRow(b)}</Each>
                  </If>
                </View>
              )}
            </Each>
            <If when={bots().length === 0}>
              <View onPress={() => botModal.set(true)} activeOpacity={0.7} style={rowBase(false)}>
                <View style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: tc("#f5f5f53d"), alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: dim(), fontSize: 16 }}>＋</Text>
                </View>
                {rowText("New Bot", "Create a named agent")}
              </View>
            </If>
            <If when={chats().length > 0}>
              <View>
                {secHeader("__chats", "Chats")}
                <If when={!collapsedSecs().__chats}>
                  <Each of={chats()}>{(t) => chatRow(t)}</Each>
                </If>
              </View>
            </If>
            <If when={hiddenBots().length > 0}>
              <View>
                {secHeader("__hidden", "Hidden Bots", () => hiddenBots().length)}
                <If when={!collapsedSecs().__hidden}>
                  <Each of={hiddenBots()}>{(b) => botRow(b)}</Each>
                </If>
              </View>
            </If>
          </Scroll>
          </View>
          {/* footer: account circle + pill (Grok's "Connect apps"; ours opens Mini Apps) */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 0 }}>
            <View style={circleBtn()} accessibilityLabel={model()}>
              <Text style={{ color: dim(), fontSize: 14, fontWeight: "500" }}>UI</Text>
            </View>
            <View
              onPress={() => tab.set(tab() === "work" ? "chat" : "work")}
              activeOpacity={0.7}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 18,
                backgroundColor: tab() === "work" ? tc("#2a2a2a") : tc("#1f1f1f"),
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingLeft: 16,
                paddingRight: 12,
              }}
            >
              <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 14, lineHeight: 20, fontWeight: "500" }}>
                Mini Apps
              </Text>
              {gridGlyph(14)}
            </View>
          </View>
        </View>
        </If>

        {/* ————— main ————— */}
        <View style={{ flex: 1, backgroundColor: tc("#161616") }}>
          <If when={tab() === "chat" && turns().length === 0}>
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 26,
                paddingHorizontal: 16,
                paddingBottom: dockH(),
              }}
            >
              <Text
                style={{ color: tc("#f5f5f5"), fontSize: 24, fontWeight: "600" }}
              >
                What's on the agenda today?
              </Text>
              {/* the same min(960, width − 32) column as the transcript and composer */}
              <View class="gap-2" style={{ width: "100%", maxWidth: 960 }}>
                <Each of={SUGGESTIONS}>
                  {(s) => (
                    <View
                      onPress={() => run(s())}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: tc("#f5f5f51f"),
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                      }}
                    >
                      <Text style={{ color: tc("#f5f5f585"), fontSize: 13 }}>✦</Text>
                      <Text style={{ color: tc("#f5f5f5"), fontSize: 14 }}>
                        {s()}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
            </View>
          </If>
          <If when={tab() === "chat" && turns().length !== 0}>
            <Scroll
              ref={scroller}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={50}
              onScroll={(e) => {
                // content growing (a diagram or image loading above) also
                // fires scroll events: only a moved offset means the user
                // scrolled, so only then may it unpin from the bottom
                console.log(`DBGS ${Date.now() % 100000} scroll y=${Math.round(e.y)} ch=${Math.round(e.contentHeight)} vh=${Math.round(e.height)} rev=${revealed()}`);
                const moved = e.y !== lastScrollY;
                lastScrollY = e.y;
                if (revealed() && moved) pinned = e.contentHeight - (e.y + e.height) < 120;
              }}
              style={{ flex: 1, opacity: revealed() ? 1 : 0 }}
            >
              <View
                onLayout={(e) => {
                  console.log(`DBGS ${Date.now() % 100000} content h=${Math.round(e.height)} pinned=${pinned} rev=${revealed()}`);
                  // hidden: keep jumping to the end until the height settles;
                  // shown and at the bottom: follow growth at once
                  if (pinned) scroller?.scrollToEnd({ animated: false });
                  if (!revealed()) settleSoon();
                }}
                // Sand: padding-inline max(16px, 50% − 480px) → a min(960, width − 32) column
                style={{ alignSelf: "center", width: "100%", maxWidth: 960 + 32, paddingHorizontal: 16, paddingTop: TOP, paddingBottom: dockH() + 8 }}
              >
                <Conversation
                  turns={turns()}
                  onReply={(i, txt, files) => replyTo.set({ i, text: txt, ...(files?.length ? { files } : {}) })}
                  onJump={(y) => scroller?.scrollTo({ y: Math.max(0, y + TOP - 24), animated: true })}
                />
              </View>
            </Scroll>
          </If>
          <If when={tab() === "work"}>
            <Scroll style={{ flex: 1 }}>
              <View style={{ alignSelf: "center", width: "100%", maxWidth: 760, paddingTop: TOP }}>
                <WidgetShelf />
              </View>
            </Scroll>
          </If>


          {/* ————— composer (Grok Bot's, measured over CDP) —————
              radius 18, 0.5px border at 12%, soft shadow; reply chip, a 64pt
              attachment strip, a 14/20 input capped at 6 lines, 28pt round
              controls; send takes the bot's color */}
          <View
            pointerEvents="box-none"
            onLayout={(e) => dockH.set(e.height)}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
          >
          {/* agent status row: the mark playing the ambient effect + the
              shimmering label — Grok's status line */}
          <If when={!!agent()}>
            <View
              onHoverIn={() => emphBot.set(agent()!.bot ?? activeBot()?.id ?? "")}
              onHoverOut={() => emphBot.set("")}
              style={{ alignSelf: "center", width: "100%", maxWidth: 960 + 32, paddingHorizontal: 16 + 4, paddingBottom: 4, flexDirection: "row", alignItems: "center", gap: 7 }}
            >
              <StatusAvatar
                shape={activeBot()?.shape ?? "blob"}
                color={activeBot()?.color ?? "#FFFFFF"}
                state={agent()!.state}
                size={20}
                emphasized={emphBot() !== ""}
                seed={agent()!.bot ?? activeBot()?.id ?? "status"}
              />
              <ShimmerText
                text={agent()!.label}
                size={11}
                color={tc("#f5f5f58a")}
                hi={tc("#f5f5f5")}
              />
            </View>
          </If>
          <KeyboardAvoidingView>
            {/* the dock shares the transcript's column (Sand's chat-input-dock) */}
            <View style={{ alignSelf: "center", width: "100%", maxWidth: 960 + 32, paddingHorizontal: 16, paddingBottom: 16 }}>
              <View
                style={{
                  backgroundColor: tc("#1f1f1f"),
                  borderRadius: 18,
                  borderWidth: 0.5,
                  borderColor: tc("#f5f5f51f"),
                  boxShadow: "0 2px 8px -1px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)",
                  overflow: "hidden",
                }}
              >
                <If when={!!replyTo()}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 10, paddingHorizontal: 12 }}>
                    <Text style={{ color: tc("#f5f5f58a"), fontSize: 12 }}>💬︎</Text>
                    <Text numberOfLines={1} style={{ flex: 1, color: tc("#f5f5f58a"), fontSize: 13, lineHeight: 18 }}>
                      {`“${(replyTo()?.text || "").replace(/\s+/g, " ").slice(0, 120)}”`}
                    </Text>
                    <View onPress={() => replyTo.set(null)} activeOpacity={0.6} accessibilityLabel="Cancel reply" style={{ padding: 4 }}>
                      <Text style={{ color: tc("#f5f5f5a3"), fontSize: 13 }}>✕</Text>
                    </View>
                  </View>
                </If>
                <If when={attachments().length > 0}>
                  <Scroll horizontal contentContainerStyle={{ flexDirection: "row", paddingVertical: 6, paddingHorizontal: 12, gap: 8 }}>
                    <Each of={attachments()}>
                      {(a) => (
                        <View
                          onHoverIn={() => attachHover.set(a().uri)}
                          onHoverOut={() => attachHover() === a().uri && attachHover.set("")}
                          accessibilityLabel={a().name}
                          style={{ width: 64, height: 64 }}
                        >
                          <FileTile a={a()} size={64} />
                          <If when={attachHover() === a().uri}>
                            <View
                              onPress={() => attachments.set(attachments().filter((x) => x.uri !== a().uri))}
                              activeOpacity={0.7}
                              accessibilityLabel={`Remove ${a().name}`}
                              style={{
                                position: "absolute",
                                top: 2,
                                right: 3,
                                width: 20,
                                height: 20,
                                borderRadius: 10,
                                backgroundColor: tc("#f5f5f5"),
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Text style={{ color: tc("#121212"), fontSize: 10, fontWeight: "700" }}>✕</Text>
                            </View>
                          </If>
                        </View>
                      )}
                    </Each>
                  </Scroll>
                </If>
                {/* Grok: + · input · dictation · voice chat (send once there is text) */}
                <View>
                  {/* the wrapper carries the cap: the input's box otherwise grows to all its text */}
                  <View style={{ paddingBottom: composerTall() ? 40 : 0, maxHeight: composerTall() ? 120 + 14 + 40 : 40, overflow: "hidden" }}>
                  <Input
                    value={draft()}
                    onChangeText={(t) => draft.set(t)}
                    placeholder={
                      replyTo()
                        ? "Reply…"
                        : attachments().length
                          ? "Add a message, or hit send"
                          : activeBot()
                            ? `Message ${activeBot()!.name}`
                            : "Ask for a UI…"
                    }
                    placeholderTextColor={tc("#f5f5f58a")}
                    multiline
                    submitBehavior="submit"
                    returnKeyType="send"
                    onSubmitEditing={send}
                    style={{
                      fontSize: 14,
                      lineHeight: 20,
                      color: tc("#f5f5f5"),
                      // one input either way (it keeps focus): short → one row
                      // between + and the right controls; tall → full width with
                      // the controls below, the scrollbar at the composer's edge
                      paddingLeft: composerTall() ? 12 : 44,
                      paddingRight: composerTall() ? 12 : rightW() + 16,
                      paddingTop: 10,
                      paddingBottom: composerTall() ? 4 : 10,
                      minHeight: composerTall() ? 34 : 40,
                      maxHeight: composerTall() ? 120 + 14 : 40,
                    }}
                  />
                  </View>
                  <View style={{ position: "absolute", left: 8, bottom: 6 }}>
                  <View
                    ref={plusBtn}
                    onPress={async () => {
                      const m = await plusBtn?.measure();
                      if (m) plusMenu.set({ x: m.pageX, y: m.pageY });
                    }}
                    activeOpacity={0.7}
                    accessibilityLabel="Composer actions"
                    style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: tc("#f5f5f50f"), alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ color: tc("#f5f5f58f"), fontSize: 17, lineHeight: 20 }}>＋</Text>
                  </View>
                  </View>
                  <View
                    onLayout={(e) => rightW.set(e.width)}
                    style={{ position: "absolute", right: 8, bottom: 6, flexDirection: "row", alignItems: "center", gap: 8 }}
                  >
                  <ModelPill choice={choice} />
                  <View
                    onHoverIn={() => attachHover.set("__dictate")}
                    onHoverOut={() => attachHover.set("")}
                    accessibilityLabel="Dictate"
                    style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" }}
                  >
                    <Text style={{ color: tc("#f5f5f58f"), fontSize: 14 }}>🎙︎</Text>
                    <If when={attachHover() === "__dictate"}>{composerTip("Click or hold ⌘D to dictate")}</If>
                  </View>
                  <If when={!!draft().trim() || attachments().length > 0}>
                    <View
                      onPress={send}
                      activeOpacity={0.8}
                      accessibilityLabel="Send message"
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: sendFill(), alignItems: "center", justifyContent: "center" }}
                    >
                      <Text style={{ color: sendInk(), fontSize: 14, fontWeight: "700" }}>↑</Text>
                    </View>
                  </If>
                  <If when={!draft().trim() && attachments().length === 0}>
                    <View
                      onHoverIn={() => attachHover.set("__voice")}
                      onHoverOut={() => attachHover.set("")}
                      accessibilityLabel="Start voice chat"
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: sendFill(), alignItems: "center", justifyContent: "center" }}
                    >
                      {/* waveform glyph */}
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 1.5 }}>
                        {[5, 9, 13, 9, 5].map((h) => (
                          <View style={{ width: 1.8, height: h, borderRadius: 1, backgroundColor: sendInk() }} />
                        ))}
                      </View>
                      <If when={attachHover() === "__voice"}>{composerTip("Start voice chat")}</If>
                    </View>
                  </If>
                  </View>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
          </View>

          {/* ————— top overlay: transparent gradient the chat scrolls under ————— */}
          <View
            desktop={{ windowDrag: true }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: TOP,
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 10,
              backgroundImage:
                tg("linear-gradient(rgba(22,22,22,0.96), rgba(22,22,22,0.7) 55%, rgba(22,22,22,0))"),
            }}
          >
            {/* center pill first: side buttons stack above it */}
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                onPress={() => rightOpen.update((v) => !v)}
                onHoverIn={() => pillHover.set(true)}
                onHoverOut={() => pillHover.set(false)}
                activeOpacity={0.85}
                accessibilityLabel={activeBot()?.name ?? "Grok Shell"}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  height: 38,
                  paddingLeft: activeBot() ? 8 : 16,
                  paddingRight: pillHover() && !rightEff() ? 10 : 16,
                  borderRadius: 19,
                  // Grok: a solid elevated card (not a tint), hairline border + soft shadow
                  backgroundColor:
                    appearance() === "dark" ? (pillHover() ? "#2c2c2c" : "#242424") : pillHover() ? "#f7f7f7" : "#ffffff",
                  borderWidth: 0.5,
                  borderColor: appearance() === "dark" ? "#ffffff14" : "#0000001a",
                  boxShadow: appearance() === "dark" ? "0 2px 8px #00000066" : "0 2px 8px #0000001f",
                }}
              >
                <If when={!!activeBot()}>
                  {/* static, like Grok's chat-header avatar (isStatic) */}
                  <BotAvatar
                    shape={activeBot()!.shape}
                    color={activeBot()!.color}
                    image={activeBot()!.image}
                    crop={activeBot()!.crop}
                    size={24}
                    box={22}
                    paused
                  />
                </If>
                <Text style={{ color: tc("#f5f5f5"), fontSize: 14, fontWeight: "500" }}>
                  {activeBot()?.name ?? "Grok Shell"}
                </Text>
                <If when={pillHover() && !rightEff()}>
                  <Text style={{ color: tc("#f5f5f5a8"), fontSize: 16 }}>›</Text>
                </If>
              </View>
            </View>
            {/* left: clear the traffic lights when no full sidebar holds them */}
            <View
              style={{
                // the full sidebar and the 88pt rail both hold the traffic lights
                width:
                  sideEff() === "full" || sideEff() === "rail"
                    ? 0
                    : Math.max(0, (titleBar().left || 77) - 10),
              }}
            />

            <View style={{ flex: 1 }} />
          </View>
        </View>

        {/* hidden sidebar: the toggle sits right of the traffic lights, on their line */}
        <If when={sideEff() === "hidden"}>
          <View style={{ position: "absolute", top: (titleBar().height || 44) / 2 - 14, left: (titleBar().left || 77) + 2, zIndex: 5 }}>
            <View onPress={toggleSide} onContextMenu={toggleSideMode} activeOpacity={0.7} accessibilityLabel="toggle sidebar" style={{ width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" }}>
              {panelGlyph(false)}
            </View>
          </View>
        </If>

        {/* ————— right details panel — Grok's info pane (320px) ————— */}
        <If when={rightEff()}>
        <View
          style={{
            width: 320,
            backgroundColor: tc("#121212"),
            borderLeftWidth: 0.5,
            borderLeftColor: tc("#f5f5f50f"),
          }}
        >
          {/* pane top: runs to the window edge — theme toggle + close at top-right */}
          <View
            desktop={{ windowDrag: true }}
            style={{ height: TOP, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingHorizontal: 12 }}
          >
            <View
              onPress={() => {
                const next = nextTheme(themePref());
                themePref.set(next);
                post("/prefs", { theme: next });
              }}
              onHoverIn={() => paneBtnHover.set("theme")}
              onHoverOut={() => paneBtnHover.set("")}
              activeOpacity={0.7}
              accessibilityLabel={`Theme: ${themePref()}`}
              style={{ ...circleBtn(), borderWidth: 1, borderColor: tc("#f5f5f50f"), backgroundColor: paneBtnHover() === "theme" ? tc("#262626") : circleBtn().backgroundColor }}
            >
              <Text style={{ color: tc("#f5f5f5e6"), fontSize: 15 }}>
                {themePref() === "light" ? "☀︎" : themePref() === "dark" ? "☾" : "◐"}
              </Text>
            </View>
            <View
              onPress={() => rightOpen.set(false)}
              onHoverIn={() => paneBtnHover.set("close")}
              onHoverOut={() => paneBtnHover.set("")}
              activeOpacity={0.7}
              accessibilityLabel="Close"
              style={{ ...circleBtn(), borderWidth: 1, borderColor: tc("#f5f5f50f"), backgroundColor: paneBtnHover() === "close" ? tc("#262626") : circleBtn().backgroundColor }}
            >
              <Text style={{ color: tc("#f5f5f5e6"), fontSize: 15 }}>✕</Text>
            </View>
          </View>

          {/* ————— bot profile (Grok's info pane, measured over CDP) ————— */}
          <If when={!!activeBot()}>
            <View
              onHoverMove={(e) => panelGaze.follow(e, 160, 40, 32)}
              onHoverOut={() => panelGaze.rest()}
              style={{ alignSelf: "stretch", alignItems: "center", paddingTop: 8 }}
            >
              {/* 64pt avatar: hover darkens (brightness .3), straightens, pencil + tooltip */}
              <View
                style={{ width: 64, height: 64, alignItems: "center", justifyContent: "center" }}
                onPress={() => openAvatarEditor()}
                onHoverIn={() => {
                  panelEditK.timing(1, { duration: 220 });
                  panelEdit.to(1);
                  avatarHover.set(true);
                }}
                onHoverOut={() => {
                  panelEditK.timing(0, { duration: 380 });
                  panelEdit.to(0);
                  avatarHover.set(false);
                }}
                accessibilityLabel="Edit Bot avatar"
              >
                <BotAvatar
                  shape={activeBot()!.shape}
                  color={activeBot()!.color}
                  image={activeBot()!.image}
                  crop={activeBot()!.crop}
                  size={80}
                  box={64}
                  gaze={panelGaze}
                  edit={panelEdit}
                  editK={panelEditK}
                  morphShape
                  seed={activeBot()!.id}
                />
                <View
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: panelEditK,
                  }}
                >
                  {/* always white — it sits on the avatar darkened to
                      brightness(0.3), in both themes (Grok's hover pen) */}
                  <Text style={{ color: "#f5f5f5", fontSize: 24 }}>✎</Text>
                </View>
              </View>
              <Input
                value={botEditName()}
                onChangeText={(t) => botEditName.set(t)}
                onSubmitEditing={() => {
                  const n = botEditName().trim();
                  if (n && n !== activeBot()!.name) updateBot(activeBot()!.id, { name: n });
                }}
                placeholder="Bot name"
                placeholderTextColor={tc("#f5f5f566")}
                style={{
                  marginTop: 16,
                  fontSize: 17,
                  lineHeight: 24,
                  fontWeight: "500",
                  color: tc("#f5f5f5"),
                  textAlign: "center",
                  alignSelf: "stretch",
                  marginHorizontal: 40,
                  paddingVertical: 2,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                }}
              />
              <Text style={{ marginTop: 4, color: tc("#f5f5f58a"), fontSize: 11, lineHeight: 16 }}>Add a label</Text>
              <View style={{ marginTop: 10 }}>
                <ModelPill choice={choice} />
              </View>
              {/* tooltip: 12pt on #1f1f1f, 8pt under the avatar, over the name */}
              <If when={avatarHover() && !avatarEditing()}>
                <View
                  style={{
                    position: "absolute",
                    top: 8 + 64 + 8,
                    paddingVertical: 4,
                    paddingHorizontal: 6,
                    borderRadius: 6,
                    backgroundColor: tc("#1f1f1f"),
                    borderWidth: 0.5,
                    borderColor: tc("#f5f5f50f"),
                  }}
                >
                  <Text style={{ color: tc("#f5f5f5"), fontSize: 12, lineHeight: 16 }}>Edit Avatar</Text>
                </View>
              </If>
              {/* Details | Library | Computer — 13/18 pills, selected .04 */}
              <View style={{ flexDirection: "row", gap: 1, paddingTop: 14, paddingBottom: 10 }}>
                <Each of={["details", "library", "computer"]}>
                  {(tb) => (
                    <View
                      onPress={() => detailTab.set(tb())}
                      activeOpacity={0.7}
                      style={{
                        borderRadius: 999,
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        backgroundColor: detailTab() === tb() ? tc("#f5f5f50a") : "transparent",
                      }}
                    >
                      <Text style={{ color: detailTab() === tb() ? tc("#f5f5f5") : dim(), fontSize: 13, lineHeight: 18 }}>
                        {tb().slice(0, 1).toUpperCase() + tb().slice(1)}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
            </View>

            <Scroll style={{ flex: 1, alignSelf: "stretch" }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 }}>
              {/* Details: sections of 48pt rows in a #1f1f1f card, a switch per row */}
              <If when={detailTab() === "details"}>
                {paneLabel("Routines")}
                <View style={{ ...paneCard(), paddingVertical: 14, paddingHorizontal: 13 }}>
                  <Text style={{ color: dim(), fontSize: 13, lineHeight: 18 }}>
                    No routines yet. Ask {activeBot()!.name} in chat to run something on a schedule.
                  </Text>
                </View>
              </If>
              {/* Library: grouped by age, 36pt rows (icon 24, title, age at the right) */}
              <If when={detailTab() === "library"}>
                <If when={threadApps().length === 0}>
                  {paneLabel("Library")}
                  <View style={{ ...paneCard(), paddingVertical: 14, paddingHorizontal: 13 }}>
                    <Text style={{ color: dim(), fontSize: 13, lineHeight: 18 }}>Files {activeBot()!.name} makes show up here.</Text>
                  </View>
                </If>
                <Each of={libraryGroups()}>
                  {(g) => (
                    <View style={{ paddingBottom: 22 }}>
                      {paneLabel(g().label)}
                      <View style={paneCard()}>
                        <Each of={g().items}>
                          {(a) => (
                            <View
                              onPress={() => post("/popout", { name: a().name })}
                              onContextMenu={() => appMenu(a())}
                              activeOpacity={0.7}
                              style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 }}
                            >
                              <View style={{ width: 24, height: 24, borderRadius: 5, backgroundColor: hue(a().name), alignItems: "center", justifyContent: "center" }}>
                                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "600" }}>{"</>"}</Text>
                              </View>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 13, lineHeight: 18 }}>{a().title}</Text>
                                <Text numberOfLines={1} style={{ color: tc("#f5f5f58a"), fontSize: 12, lineHeight: 16 }}>{a().file}</Text>
                              </View>
                              <Text style={{ color: tc("#f5f5f58a"), fontSize: 13, lineHeight: 18 }}>{ago(a().mtime)}</Text>
                            </View>
                          )}
                        </Each>
                      </View>
                    </View>
                  )}
                </Each>
              </If>
              {/* Computer: 180pt #161616 card, the muted sleeping avatar + zzz */}
              <If when={detailTab() === "computer"}>
                <View
                  accessibilityLabel="Wake computer"
                  style={{ height: 180, borderRadius: 12, backgroundColor: tc("#161616"), alignItems: "center", justifyContent: "center" }}
                >
                  <SleepingBlob shape={activeBot()!.shape} size={33} ink={tc("#f5f5f58a")} />
                  <Text style={{ marginTop: 6, color: tc("#f5f5f5"), fontSize: 13, lineHeight: 18, fontWeight: "500" }}>Computer is asleep</Text>
                </View>
                <Text style={{ marginTop: 10, textAlign: "center", color: tc("#f5f5f58a"), fontSize: 12, lineHeight: 16 }}>
                  {`${activeBot()!.name}'s screen`}
                </Text>
              </If>
            </Scroll>
          </If>
          <If when={!detail() && !activeBot()}>
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14 }}>
              <Text style={{ color: tc("#f5f5f566"), fontSize: 13 }}>
                No app in this conversation yet
              </Text>
              <Text style={{ color: tc("#f5f5f566"), fontSize: 11, textAlign: "center" }}>
                generated apps show their details here
              </Text>
            </View>
          </If>
          <If when={!!detail() && !activeBot()}>
            <View style={{ alignItems: "center", gap: 10, alignSelf: "stretch", paddingHorizontal: 14 }}>
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 20,
                  backgroundColor: hue(detail()!.name),
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#fff", fontSize: 26, fontWeight: "700" }}>
                  {(detail()!.title || "?").slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <Text style={{ color: tc("#f5f5f5"), fontSize: 15, fontWeight: "600" }}>
                {detail()!.title}
              </Text>
              <Text style={{ color: tc("#f5f5f566"), fontSize: 11 }}>
                {`app · ${detail()!.name}.tsx${detail()!.pinned ? " · ★ pinned" : ""}`}
              </Text>

              {/* tab pills */}
              <View
                style={{
                  flexDirection: "row",
                  backgroundColor: tc("#f5f5f50f"),
                  borderRadius: 999,
                  padding: 3,
                  marginTop: 4,
                }}
              >
                <View
                  onPress={() => detailTab.set("details")}
                  activeOpacity={0.7}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 4,
                    backgroundColor: detailTab() === "details" ? tc("#f5f5f51f") : "transparent",
                  }}
                >
                  <Text style={{ color: detailTab() === "details" ? tc("#f5f5f5") : tc("#f5f5f585"), fontSize: 12, fontWeight: "600" }}>
                    Details
                  </Text>
                </View>
                <View
                  onPress={() => detailTab.set("state")}
                  activeOpacity={0.7}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 16,
                    paddingVertical: 4,
                    backgroundColor: detailTab() === "state" ? tc("#f5f5f51f") : "transparent",
                  }}
                >
                  <Text style={{ color: detailTab() === "state" ? tc("#f5f5f5") : tc("#f5f5f585"), fontSize: 12, fontWeight: "600" }}>
                    State
                  </Text>
                </View>
              </View>

              <Scroll style={{ flex: 1, alignSelf: "stretch" }}>
                <If when={detailTab() === "details"}>
                  <View class="gap-2 self-stretch pt-3">
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: tc("#f5f5f585"), fontSize: 12 }}>module</Text>
                      <Text style={{ color: tc("#f5f5f5"), fontSize: 12 }}>{detail()!.name}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ color: tc("#f5f5f585"), fontSize: 12 }}>status</Text>
                      <Text style={{ color: tc("#f5f5f5"), fontSize: 12 }}>
                        {detail()!.published ? "in Mini Apps" : "chat only"}
                      </Text>
                    </View>
                    <If when={detail()!.kinds.length > 0}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ color: tc("#f5f5f585"), fontSize: 12 }}>kinds</Text>
                        <Text style={{ color: tc("#f5f5f5"), fontSize: 12 }}>{detail()!.kinds.join(" · ")}</Text>
                      </View>
                    </If>
                    <If when={detail()!.tags.length > 0}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ color: tc("#f5f5f585"), fontSize: 12 }}>tags</Text>
                        <Text style={{ color: tc("#f5f5f5"), fontSize: 12 }}>{detail()!.tags.map((t) => "#" + t).join(" ")}</Text>
                      </View>
                    </If>
                  </View>
                </If>
                <If when={detailTab() === "state"}>
                  <View class="gap-2 self-stretch pt-3">
                    <If when={detailState().length === 0}>
                      <Text style={{ color: tc("#f5f5f566"), fontSize: 12 }}>
                        no persisted state
                      </Text>
                    </If>
                    <Each of={detailState()}>
                      {(kv) => (
                        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                          <Text style={{ color: tc("#f5f5f585"), fontSize: 12 }}>{kv()[0]}</Text>
                          <Text style={{ color: tc("#f5f5f5"), fontSize: 12, fontFamily: "Menlo" }} numberOfLines={2}>
                            {kv()[1]}
                          </Text>
                        </View>
                      )}
                    </Each>
                  </View>
                </If>
              </Scroll>

              {/* actions */}
              <View class="self-stretch gap-2 pb-1">
                <View
                  onPress={() => post("/popout", { name: detail()!.name })}
                  activeOpacity={0.7}
                  style={{
                    borderRadius: 10,
                    backgroundColor: tc("#f5f5f514"),
                    paddingVertical: 9,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: tc("#f5f5f5"), fontSize: 13, fontWeight: "600" }}>
                    Open window
                  </Text>
                </View>
                <View
                  onPress={() => post("/pin", { name: detail()!.name, pinned: !detail()!.pinned }).then(refreshThreads)}
                  activeOpacity={0.7}
                  style={{
                    borderRadius: 10,
                    backgroundColor: tc("#f5f5f514"),
                    paddingVertical: 9,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: tc("#f5f5f5"), fontSize: 13 }}>
                    {detail()!.pinned ? "Unpin from desktop widget" : "Pin to desktop widget"}
                  </Text>
                </View>
                <If when={!detail()!.published}>
                  <View
                    onPress={() => post("/publish", { name: detail()!.name }).then(refreshThreads)}
                    activeOpacity={0.7}
                    style={{
                      borderRadius: 10,
                      backgroundColor: "#1884fc",
                      paddingVertical: 9,
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>
                      Save to Mini Apps
                    </Text>
                  </View>
                </If>
              </View>
            </View>
          </If>
        </View>
        </If>

        {/* ————— rail/pin hover popover: name + 2-line preview, vertically
            centered on the hovered element's measured center ————— */}
        <If when={!!railPop()}>
          <View
            style={{
              position: "absolute",
              left: railPop()!.x,
              top: Math.max(
                8,
                railPop()!.cy -
                  (20 + 18 + 4 + Math.min(2, Math.max(1, Math.ceil((railPop()!.bot.preview || "No messages yet").length / 34))) * 18) / 2,
              ),
              width: 260,
              padding: 10,
              gap: 4,
              borderRadius: 12,
              backgroundColor: tc("#1f1f1f"),
              borderWidth: 0.5,
              borderColor: tc("#f5f5f50f"),
              boxShadow: "0 10px 20px -3px rgba(0,0,0,0.45)",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 18 }}>
              <View style={{ width: 16, height: 16, alignItems: "center", justifyContent: "center" }}>
                <BotAvatar
                  shape={railPop()!.bot.shape}
                  color={railPop()!.bot.color}
                  image={railPop()!.bot.image}
                  crop={railPop()!.bot.crop}
                  size={20}
                  box={16}
                  paused
                />
              </View>
              <Text numberOfLines={1} style={{ flex: 1, color: tc("#f5f5f5"), fontSize: 13, lineHeight: 18, fontWeight: "500" }}>
                {railPop()!.bot.name}
              </Text>
            </View>
            <Text numberOfLines={2} style={{ color: dim(), fontSize: 13, lineHeight: 18 }}>
              {railPop()!.bot.preview || "No messages yet"}
            </Text>
          </View>
        </If>

        {/* ————— rail flyout: floats over the chat when the window is too narrow for any sidebar ————— */}
        <If when={sideEff() === "rail-flyout"}>
          <View
            onPress={() => sidePeek.set(false)}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              right: 0,
              backgroundColor: "#00000066",
            }}
          />
          <View
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              flexDirection: "row",
            }}
          >
            {railView(true)}
          </View>
        </If>
        </View>

        {/* ————— avatar editor: Grok's floating card under the pane avatar —————
            297 wide, radius 16, #1f1f1f, 0.5px border; Bot | Generate | Upload
            pills (13/18) + Reset; it sizes to its content and a click anywhere
            outside (or Escape) dismisses it. */}
        <If when={avatarEditing() && rightEff() && !!activeBot()}>
          <View
            onPress={closeAvatarEditor}
            style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
          />
          <View
            onPress={() => {}}
            style={{
              position: "absolute",
              right: 11,
              top: TOP + 8 + 64 + 6,
              width: 297,
              borderRadius: 16,
              backgroundColor: tc("#1f1f1f"),
              borderWidth: 0.5,
              borderColor: tc("#f5f5f50f"),
              boxShadow: "0 10px 20px -3px rgba(0,0,0,0.5), 0 4px 6px -4px rgba(0,0,0,0.4)",
              overflow: "hidden",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 9, paddingHorizontal: 8, gap: 2 }}>
              <Each of={["bot", "generate", "upload"]}>
                {(tb) => (
                  <View
                    onPress={() => {
                      avatarEditTab.set(tb());
                      avatarErr.set("");
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="tab"
                    style={{
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      backgroundColor: avatarEditTab() === tb() ? tc("#f5f5f50a") : "transparent",
                    }}
                  >
                    <Text style={{ color: avatarEditTab() === tb() ? tc("#f5f5f5") : dim(), fontSize: 13, lineHeight: 18 }}>
                      {tb().slice(0, 1).toUpperCase() + tb().slice(1)}
                    </Text>
                  </View>
                )}
              </Each>
              <View style={{ flex: 1 }} />
              <If when={avatarEditTab() === "bot"}>
                <View
                  onPress={() => updateBot(activeBot()!.id, { shape: "blob", color: "#FFFFFF", image: "", crop: null })}
                  activeOpacity={0.7}
                  accessibilityLabel="Reset avatar"
                  style={{ height: 22, paddingHorizontal: 8, borderRadius: 8, justifyContent: "center" }}
                >
                  <Text style={{ color: dim(), fontSize: 13, lineHeight: 18 }}>Reset</Text>
                </View>
              </If>
            </View>

            {/* Bot: 48pt shapes 5 per row, 32pt swatches 6 per row */}
            <If when={avatarEditTab() === "bot"}>
              <View style={{ paddingTop: 26, paddingHorizontal: 12, paddingBottom: 20, gap: 26 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
                  <Each of={BOT_SHAPES}>
                    {(sh) => (
                      <View
                        onPress={() => updateBot(activeBot()!.id, { shape: sh(), image: "", crop: null })}
                        activeOpacity={0.7}
                        accessibilityLabel={`${sh()} character shape`}
                        style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
                      >
                        {/* Grok: the resting pose at a 36pt box; a thin ring marks the pick */}
                        <If when={!activeBot()!.image && activeBot()!.shape === sh()}>
                          <View
                            style={{
                              position: "absolute",
                              width: 46,
                              height: 46,
                              borderRadius: 23,
                              borderWidth: 1.5,
                              borderColor: tc("#f5f5f53d"),
                            }}
                          />
                        </If>
                        <BotBlob shape={sh()} color={inkOf("#FFFFFF")} size={44} paused />
                      </View>
                    )}
                  </Each>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, paddingHorizontal: 20 }}>
                  <Each of={BOT_COLORS}>
                    {(c) => (
                      <View
                        onPress={() => updateBot(activeBot()!.id, { color: c(), image: "", crop: null })}
                        activeOpacity={0.7}
                        accessibilityLabel={`${c()} character color`}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          alignItems: "center",
                          justifyContent: "center",
                          // Grok: 3pt gap + 1pt ring at 24% of the text color
                          borderWidth: 1,
                          borderColor: !activeBot()!.image && sameColor(activeBot()!.color, c()) ? tc("#f5f5f53d") : "transparent",
                        }}
                      >
                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: inkOf(c()) }} />
                      </View>
                    )}
                  </Each>
                </View>
              </View>
            </If>

            {/* Generate: prompt → generating (prompt shrinks, placeholder pulses) → crop */}
            <If when={avatarEditTab() === "generate"}>
              <View style={{ paddingTop: 20, paddingHorizontal: 12, paddingBottom: 13, gap: 12 }}>
                <If when={!genDraft()}>
                  <Input
                    value={avatarGenPrompt()}
                    onChangeText={(t) => avatarGenPrompt.set(t)}
                    placeholder="Describe your avatar…"
                    placeholderTextColor={tc("#f5f5f566")}
                    multiline={!avatarGenBusy()}
                    editable={!avatarGenBusy()}
                    style={{
                      height: avatarGenBusy() ? 32 : 174,
                      fontSize: 14,
                      lineHeight: 22,
                      color: tc("#f5f5f5"),
                      backgroundColor: tc("#1f1f1f"),
                      paddingVertical: avatarGenBusy() ? 5 : 8,
                      paddingHorizontal: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: tc("#f5f5f51a"),
                      textAlignVertical: "top",
                    }}
                  />
                  <If when={avatarGenBusy()}>
                    <View style={{ alignItems: "center", paddingVertical: 12 }}>
                      <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: tc("#2a2a2a"), opacity: genPulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }} />
                    </View>
                  </If>
                  <View
                    onPress={generateAvatar}
                    activeOpacity={0.8}
                    style={{
                      height: 30,
                      borderRadius: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: avatarGenBusy() ? tc("#f5f5f50f") : avatarGenPrompt().trim() ? tc("#f5f5f5") : tc("#f5f5f566"),
                    }}
                  >
                    <Text style={{ color: avatarGenBusy() ? tc("#f5f5f58a") : tc("#121212"), fontSize: 13, lineHeight: 18 }}>
                      {avatarGenBusy() ? "Generating…" : "Generate"}
                    </Text>
                  </View>
                </If>
                <If when={!!genDraft()}>{cropEditor(genDraft()!, false, () => genDraft.set(null))}</If>
                <If when={!!avatarErr()}>
                  <Text style={{ color: "#ff7b7b", fontSize: 12, lineHeight: 16, textAlign: "center" }}>{avatarErr()}</Text>
                </If>
              </View>
            </If>

            {/* Upload: dashed drop zone (paste works with ⌘V) → crop with name · size */}
            <If when={avatarEditTab() === "upload"}>
              <View style={{ paddingTop: 20, paddingHorizontal: 12, paddingBottom: 13, gap: 12 }}>
                <If when={!upDraft()}>
                  <View
                    style={{
                      height: 216,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderStyle: "dashed",
                      borderColor: tc("#f5f5f51a"),
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 12,
                    }}
                  >
                    <Text style={{ color: dim(), fontSize: 14, lineHeight: 22 }}>Drag, drop, or paste an image</Text>
                    <Text style={{ color: tc("#f5f5f58a"), fontSize: 14, lineHeight: 22, marginTop: 8 }}>or</Text>
                    <View
                      onPress={() => pickAvatar("pick")}
                      activeOpacity={0.7}
                      style={{ marginTop: 8, height: 30, paddingHorizontal: 13, borderRadius: 10, backgroundColor: tc("#f5f5f50a"), justifyContent: "center" }}
                    >
                      <Text style={{ color: tc("#f5f5f5"), fontSize: 13, lineHeight: 18 }}>Browse files</Text>
                    </View>
                  </View>
                </If>
                <If when={!!upDraft()}>{cropEditor(upDraft()!, true, () => upDraft.set(null))}</If>
                <If when={!!avatarErr()}>
                  <Text style={{ color: "#ff7b7b", fontSize: 12, lineHeight: 16, textAlign: "center" }}>{avatarErr()}</Text>
                </If>
              </View>
            </If>
          </View>
        </If>

        {/* ————— composer + menu (Attach files · Teach a task) ————— */}
        <If when={!!plusMenu()}>
          <View onPress={() => plusMenu.set(null)} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
          <View
            onPress={() => {}}
            style={{
              position: "absolute",
              left: plusMenu()!.x - 4,
              top: plusMenu()!.y - 6 - 64,
              width: 172,
              padding: 4,
              borderRadius: 10,
              backgroundColor: tc("#1f1f1f"),
              borderWidth: 0.5,
              borderColor: tc("#f5f5f51a"),
              boxShadow: "0 8px 20px -4px rgba(0,0,0,0.4)",
            }}
          >
            {[
              { id: "attach", label: "Attach files", icon: "📎︎", run: pickAttachments, enabled: true },
              { id: "teach", label: "Teach a task", icon: "", run: () => {}, enabled: false },
            ].map((it) => (
              <View
                onPress={() => {
                  if (!it.enabled) return;
                  plusMenu.set(null);
                  it.run();
                }}
                onHoverIn={() => plusHover.set(it.id)}
                onHoverOut={() => plusHover() === it.id && plusHover.set("")}
                activeOpacity={it.enabled ? 0.8 : 1}
                accessibilityLabel={it.label}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  height: 28,
                  paddingHorizontal: 8,
                  borderRadius: 6,
                  backgroundColor: plusHover() === it.id && it.enabled ? tc("#f5f5f50f") : "transparent",
                  opacity: it.enabled ? 1 : 0.5,
                }}
              >
                <View style={{ width: 14, alignItems: "center" }}>
                  {it.id === "teach" ? (
                    <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 1.5, borderColor: "#e72e3b", alignItems: "center", justifyContent: "center" }}>
                      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: "#e72e3b" }} />
                    </View>
                  ) : (
                    <Text style={{ color: tc("#f5f5f5a8"), fontSize: 12 }}>{it.icon}</Text>
                  )}
                </View>
                <Text style={{ color: tc("#f5f5f5"), fontSize: 13, lineHeight: 18 }}>{it.label}</Text>
              </View>
            ))}
          </View>
        </If>

        {/* ————— fullscreen file viewer (reply files) ————— */}
        <FileViewer />

        {/* ————— media lightbox (images · videos · diagrams) ————— */}
        <Lightbox />

        {/* ————— ⌘K command palette ————— */}
        <Palette items={paletteItems} />

        {/* ————— model picker popover (effort card / model list) ————— */}
        <ModelPopover choice={choice} setChoice={setChoice} />

        {/* ————— Move to new section: name prompt ————— */}
        <If when={!!sectionPrompt()}>
          <View
            onPress={() => sectionPrompt.set(null)}
            style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#00000080", alignItems: "center", justifyContent: "center" }}
          >
            <View
              onPress={() => {}}
              style={{ width: 320, borderRadius: 16, backgroundColor: tc("#1f1f1f"), borderWidth: 0.5, borderColor: tc("#f5f5f51a"), padding: 16, gap: 12 }}
            >
              <Text style={{ color: tc("#f5f5f5"), fontSize: 15, fontWeight: "600" }}>New section</Text>
              <View style={{ borderRadius: 10, borderWidth: 1, borderColor: tc("#f5f5f51f"), backgroundColor: tc("#161616"), paddingHorizontal: 10 }}>
                <Input
                  value={sectionName()}
                  onChangeText={(t) => sectionName.set(t)}
                  placeholder="Section name"
                  placeholderTextColor={tc("#f5f5f566")}
                  autoFocus
                  onSubmitEditing={() => {
                    const n = sectionName().trim();
                    if (n) moveToSection(sectionPrompt()!, n);
                    sectionPrompt.set(null);
                  }}
                  style={{ fontSize: 14, color: tc("#f5f5f5"), paddingVertical: 9 }}
                />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <View onPress={() => sectionPrompt.set(null)} activeOpacity={0.7} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 }}>
                  <Text style={{ color: dim(), fontSize: 13, fontWeight: "500" }}>Cancel</Text>
                </View>
                <View
                  onPress={() => {
                    const n = sectionName().trim();
                    if (n) moveToSection(sectionPrompt()!, n);
                    sectionPrompt.set(null);
                  }}
                  activeOpacity={0.7}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: tc("#f5f5f5") }}
                >
                  <Text style={{ color: tc("#121212"), fontSize: 13, fontWeight: "600" }}>Move</Text>
                </View>
              </View>
            </View>
          </View>
        </If>

        {/* ————— Library rename: title / display file name ————— */}
        <If when={!!appRename()}>
          <View
            onPress={() => appRename.set(null)}
            style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#00000080", alignItems: "center", justifyContent: "center" }}
          >
            <View
              onPress={() => {}}
              style={{ width: 320, borderRadius: 16, backgroundColor: tc("#1f1f1f"), borderWidth: 0.5, borderColor: tc("#f5f5f51a"), padding: 16, gap: 12 }}
            >
              <Text style={{ color: tc("#f5f5f5"), fontSize: 15, fontWeight: "600" }}>
                {appRename()?.field === "file" ? "Rename File Name" : "Rename Title"}
              </Text>
              <View style={{ borderRadius: 10, borderWidth: 1, borderColor: tc("#f5f5f51f"), backgroundColor: tc("#161616"), paddingHorizontal: 10 }}>
                <Input
                  value={appRenameText()}
                  onChangeText={(t) => appRenameText.set(t)}
                  placeholder={appRename()?.field === "file" ? "file-name.tsx" : "App title"}
                  placeholderTextColor={tc("#f5f5f566")}
                  autoFocus
                  onSubmitEditing={saveAppRename}
                  style={{ fontSize: 14, color: tc("#f5f5f5"), paddingVertical: 9 }}
                />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <View onPress={() => appRename.set(null)} activeOpacity={0.7} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 }}>
                  <Text style={{ color: dim(), fontSize: 13, fontWeight: "500" }}>Cancel</Text>
                </View>
                <View
                  onPress={saveAppRename}
                  activeOpacity={0.7}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: tc("#f5f5f5") }}
                >
                  <Text style={{ color: tc("#121212"), fontSize: 13, fontWeight: "600" }}>Rename</Text>
                </View>
              </View>
            </View>
          </View>
        </If>

        {/* ————— Create New Bot: Grok's sheet — live blob preview, name, shape grid, color grid ————— */}
        <If when={botModal()}>
          <View
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              right: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* scrim is a sibling behind the sheet — sheet taps never reach it */}
            <View
              onPress={() => botModal.set(false)}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                right: 0,
                backgroundColor: "#00000080",
              }}
            />
            {/* Grok's dialog (CDP): 440 wide, radius 14, 0.5pt border at 12%,
                elevated surface; header 55; body 16 padding; footer rule */}
            <View
              style={{
                width: 440,
                borderRadius: 14,
                backgroundColor: appearance() === "dark" ? "#1f1f1f" : "#ffffff",
                borderWidth: 0.5,
                borderColor: tc("#f5f5f51f"),
                boxShadow: "0 16px 48px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)",
                overflow: "hidden",
              }}
            >
              {/* header: 14/600 title; 32pt round close */}
              <View style={{ height: 55, flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 10 }}>
                <Text style={{ flex: 1, color: tc("#f5f5f5"), fontSize: 14, lineHeight: 22, fontWeight: "600" }}>Create New Bot</Text>
                <View
                  onPress={() => botModal.set(false)}
                  onHoverIn={() => botHover.set("close")}
                  onHoverOut={() => botHover.set("")}
                  activeOpacity={0.7}
                  accessibilityLabel="Close dialog"
                  style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: botHover() === "close" ? tc("#f5f5f50f") : "transparent" }}
                >
                  <Text style={{ color: tc("#f5f5f5ad"), fontSize: 14 }}>✕</Text>
                </View>
              </View>

              <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, alignItems: "center" }}>
                {/* 96pt live preview */}
                <View style={{ width: 96, height: 96, alignItems: "center", justifyContent: "center" }}>
                  <BotBlob shape={botShape()} color={inkOf(botColor())} size={96} paused={false} />
                </View>

                {/* name: 35 tall, radius 8, hairline, centered 13pt */}
                <View style={{ alignSelf: "stretch", marginTop: 16, height: 35, borderRadius: 8, borderWidth: 0.5, borderColor: tc("#f5f5f51f"), justifyContent: "center", paddingHorizontal: 10 }}>
                  <Input
                    value={botName()}
                    onChangeText={(t) => botName.set(t)}
                    placeholder="Name your Bot"
                    placeholderTextColor={tc("#f5f5f566")}
                    onSubmitEditing={() => botName().trim() && createBot()}
                    style={{ fontSize: 13, color: tc("#f5f5f5"), textAlign: "center" }}
                  />
                </View>

                {/* shapes: 48pt cells, 8 gap, 5 a row (272 wide), in the picked color; ring marks the pick */}
                <View style={{ width: 272, marginTop: 16, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
                  <Each of={BOT_SHAPES}>
                    {(sh) => (
                      <View
                        onPress={() => botShape.set(sh())}
                        onHoverIn={() => botHover.set("s:" + sh())}
                        onHoverOut={() => botHover.set("")}
                        activeOpacity={0.7}
                        accessibilityLabel={`${sh()} character shape`}
                        style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
                      >
                        <If when={botShape() === sh() || botHover() === "s:" + sh()}>
                          <View
                            style={{
                              position: "absolute",
                              width: 44,
                              height: 44,
                              borderRadius: 22,
                              borderWidth: 1.5,
                              borderColor: botShape() === sh() ? tc("#f5f5f53d") : tc("#f5f5f51f"),
                            }}
                          />
                        </If>
                        <BotBlob shape={sh()} color={inkOf(botColor())} size={44} paused />
                      </View>
                    )}
                  </Each>
                </View>

                {/* colors: 32pt buttons (24pt dot), 8 gap, 6 a row (232 wide); 1pt ring at 24% */}
                <View style={{ width: 232, marginTop: 12, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
                  <Each of={BOT_COLORS}>
                    {(c) => (
                      <View
                        onPress={() => botColor.set(c())}
                        activeOpacity={0.7}
                        accessibilityLabel={`${c()} character color`}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 1,
                          borderColor: botColor() === c() ? tc("#f5f5f53d") : "transparent",
                        }}
                      >
                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: inkOf(c()) }} />
                      </View>
                    )}
                  </Each>
                </View>
              </View>

              {/* footer: hairline rule; 32pt pills, 14pt; Create greys out until named */}
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingTop: 12, paddingBottom: 12, paddingLeft: 16, paddingRight: 12, borderTopWidth: 0.5, borderTopColor: tc("#f5f5f51f") }}>
                <View
                  onPress={() => botModal.set(false)}
                  onHoverIn={() => botHover.set("cancel")}
                  onHoverOut={() => botHover.set("")}
                  activeOpacity={0.7}
                  style={{ height: 32, borderRadius: 999, paddingHorizontal: 12, justifyContent: "center", backgroundColor: botHover() === "cancel" ? tc("#f5f5f51a") : tc("#f5f5f50f") }}
                >
                  <Text style={{ color: tc("#f5f5f5"), fontSize: 14 }}>Cancel</Text>
                </View>
                <View
                  onPress={() => botName().trim() && createBot()}
                  activeOpacity={botName().trim() ? 0.8 : 1}
                  style={{ height: 32, borderRadius: 999, paddingHorizontal: 12, justifyContent: "center", backgroundColor: botName().trim() ? tc("#f5f5f5") : tc("#f5f5f526") }}
                >
                  <Text style={{ color: botName().trim() ? tc("#121212") : tc("#f5f5f54d"), fontSize: 14 }}>Create</Text>
                </View>
              </View>
            </View>
          </View>
        </If>
      </View>
    </SafeAreaView>
  );
}

mount(App);
