import { cleanup, effect, Input, Scroll, signal, Text, View, type YNode } from "nsh";
import { windowSize } from "nsh/device";
import { FileTile } from "./filetile";
import { Icon } from "./icons";
import { AudioCard, FileCard, MediaGallery, openFile } from "./fileviewer";
import { appearance, bubbleFill, OnFill, tc, tg } from "./theme";
import { keymap } from "nsh/keymap";
import { ShimmerText } from "./statusfx";

// Grok's agent bubble: the base color at 6% (bubbleAgent 0f): a light grey on
// the light pane, not white
const agentFill = () => (appearance() === "light" ? "#0000000f" : tc("#1f1f1f"));
import { Menu } from "nsh/desktop";
import { Markdown } from "./md";
import { MODULES } from "../generated/index";

// while the chat scrolls, hover bars stay dark — every row the pointer
// crosses would otherwise light up mid-scroll (noise + wasted layout)
export const chatScrolling = signal(false);

// ChatGPT-style action row + chrome around every generated widget.
//   👍 👎  persist a reaction   ·   ↻ regenerate in place (rewrites this module)
//   </> view/copy the module's own source   ·   ⤴ reveal the file in Finder
//   ⧉ copy the widget's TSX source to the clipboard

const GEN = "http://127.0.0.1:8787";

// Modules generated after this bundle was built are not in MODULES — the
// host serves their chunk from NSH_CHUNK_DIR through __nsh_import
// (nsh-macos load_chunk). One signal per key re-renders the row when the
// chunk lands; "loading" shows a placeholder instead of the
// module-missing flash. A missing chunk settles null → the old fallback.
const dynMods = new Map<string, any>();
function moduleOf(key: string): any {
  let s = dynMods.get(key);
  if (!s) {
    s = signal<any>("loading");
    dynMods.set(key, s);
    const imp = (globalThis as any).__nsh_import;
    if (typeof imp === "function")
      // chunk ids are flat <stem>.js — "R6@v3" ships as "R6v3.js"
      Promise.resolve(imp(`${key.replace(/^R(\d+)@v(\d+)$/, "R$1v$2")}.js`))
        .then((ns: any) => s.set(ns?.default ?? null))
        .catch(() => s.set(null));
    else s.set(null);
  }
  return s();
}

const post = (path: string, body: object) =>
  fetch(`${GEN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

// Deletes a conversation turn. `idx:` keys drop that one message (either
// role); `name:` keys drop a card and the prompt that made it. Module files
// and published mini-apps are untouched.
export function DelBtn({ k }: { k: string }) {
  return (
    <View
      onPress={() => post("/turn/delete", { key: k })}
      activeOpacity={0.7}
      accessibilityLabel="delete this message"
      style={{
        alignSelf: "flex-start",
        borderRadius: 6,
        paddingHorizontal: 5,
        paddingVertical: 1,
      }}
    >
      <Text style={{ color: tc("#f5f5f566"), fontSize: 11 }}>✕</Text>
    </View>
  );
}

// One conversation row: user bubble / markdown reply / app card. Turns arrive
// as plain JSON from GET /turns — switching threads swaps data, no rebuild.
// Small round action in the hover bar.
// Grok's message actions: bare 24pt icon buttons (no pill around them); the
// hovered one gets a rounded plate
function Act({ glyph, onPress, title }: { glyph: string; onPress: () => void; title: string }) {
  const h = signal(false);
  return (
    <View
      onPress={onPress}
      onHoverIn={() => h.set(true)}
      onHoverOut={() => h.set(false)}
      activeOpacity={0.6}
      accessibilityLabel={title}
      style={{ width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center", backgroundColor: h() ? tc("#f5f5f514") : "transparent" }}
    >
      <Text style={{ color: tc("#f5f5f5a8"), fontSize: 15 }}>{glyph}</Text>
    </View>
  );
}

// Horizontal emoji pill — floats by the action bar (approved design
// preview: chat-actions-artifacts-preview.html, option 1B). The emoji-plus
// button expands to a full scrollable grid; picking the current emoji
// clears it.
const EMOJI = ["👍", "❤️", "😂", "😮", "👎"];
const EMOJI_GRID = [
  "😀","😄","😁","🤣","😂","🙂","😉","😊","😇","🥰","😍","🤩","😘","😋","😛","🤪","😜","😝","🤑","🤗",
  "🤭","🤫","🤔","🫡","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕",
  "🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","😎","🤓","🧐","😕","😟","🙁","😮","😯","😲","😳","🥺",
  "😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","💕","💖","💗","💯","✨","⭐","🌟","💫","🔥","🎉",
  "👍","👎","👏","🙌","🙏","🤝","💪","🫶","👌","✌️","🤞","🫰","🤙","👋","✋","🖐️","🖖","👆","👇","☝️",
  "👽","🤖","💀","🎃","🚀","🎮","🎯","🏆","🥇","🍕","🍔","🍩","☕","🍺","⚡","🌈","☀️","🌙","❄️","🐛",
];
function EmojiPill(props: { current: string; onPick: (e: string) => void }) {
  const grid = signal(false);
  const dot = (e: string) => {
    const h = signal(false);
    return (
      <View
        onPress={() => props.onPick(e === props.current ? "" : e)}
        onHoverIn={() => h.set(true)}
        onHoverOut={() => h.set(false)}
        activeOpacity={0.9}
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: e === props.current ? tc("#f5f5f52b") : h() ? tc("#f5f5f514") : "transparent",
          transform: [{ scale: h() ? 1.25 : 1 }],
          transitionProperty: "transform",
          transitionDuration: "120ms",
        }}
      >
        <Text style={{ fontSize: 17 }}>{e}</Text>
      </View>
    );
  };
  const plusH = signal(false);
  return (
    <View
      style={{
        flexDirection: "column",
        gap: 2,
        paddingHorizontal: 6,
        paddingVertical: 5,
        borderRadius: 20,
        backgroundColor: appearance() === "dark" ? "#262626" : "#ffffff",
        borderWidth: 1,
        borderColor: tc("#f5f5f51f"),
      }}
    >
      <View style={{ flexDirection: "row", gap: 2 }}>
        {EMOJI.map(dot)}
        <View
          onPress={() => grid.update((v) => !v)}
          onHoverIn={() => plusH.set(true)}
          onHoverOut={() => plusH.set(false)}
          activeOpacity={0.9}
          style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: grid() || plusH() ? tc("#f5f5f514") : "transparent", transform: [{ scale: plusH() ? 1.25 : 1 }], transitionProperty: "transform", transitionDuration: "120ms" }}
        >
          <Icon name="emojiPlus" size={20} color={tc("#f5f5f5a8")} />
        </View>
      </View>
      <If when={grid()}>
        <Scroll style={{ maxHeight: 160, width: 226 }} contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 2 }}>
          {EMOJI_GRID.map(dot)}
        </Scroll>
      </If>
    </View>
  );
}

// Exact-size placeholder while an artifact builds or its chunk loads — the
// model declares the size (`t.art`), the status line mirrors the job phase
// (preview option 5B). No filename, no R-name.
function ArtPlaceholder({ t, status }: { t: any; status?: string }) {
  const w = Math.min(t.art?.w || 480, 560);
  const ar = t.art?.w && t.art?.h ? t.art.w / t.art.h : 4 / 3;
  const title = t.art?.title || (t.label === "image" ? "Image" : "Mini app");
  return (
    <View
      class="self-start"
      style={{
        width: w,
        maxWidth: "100%",
        borderRadius: 16,
        backgroundColor: tc("#1f1f1f"),
        borderWidth: 1,
        borderColor: tc("#f5f5f50f"),
        padding: 12,
      }}
    >
      <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 14, fontWeight: "600" }}>
        {title}
      </Text>
      <If when={!!t.art?.desc}>
        <Text numberOfLines={1} style={{ color: tc("#f5f5f5a8"), fontSize: 12, marginTop: 2 }}>
          {t.art?.desc || ""}
        </Text>
      </If>
      <View
        style={{
          marginTop: 10,
          width: "100%",
          aspectRatio: ar,
          borderRadius: 10,
          backgroundColor: tc("#f5f5f50a"),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 170 }}>
          <ShimmerText
            text={status || t.status || "Loading…"}
            size={12}
            color={tc("#f5f5f566")}
            hi={tc("#f5f5f5")}
          />
        </View>
        <If when={!!(t.art?.w && t.art?.h)}>
          <Text style={{ position: "absolute", right: 8, bottom: 6, fontSize: 10.5, color: tc("#f5f5f54d") }}>
            {`${t.art?.w}×${t.art?.h}`}
          </Text>
        </If>
      </View>
    </View>
  );
}

// One conversation row: user bubble / markdown reply / app card. Turns arrive
// as plain JSON from GET /turns — switching threads swaps data, no rebuild.
// Hovering a bubble reveals the action pill (react / reply / more); ⋯ opens
// the native context menu, which the OS flips up or down to stay on screen.
function TurnRow({ t, onReply, onJump, onPicker }: {
  t: any;
  onReply?: (i: number, text: string, files?: string[]) => void;
  onJump?: (i: number) => void;
  onPicker?: (open: boolean, close: () => void) => void;
}) {
  const hov = signal(false);
  // which bar opened the emoji pill: "msg" or "art:<file path>"
  const picker = signal("");
  // reports open/close up to Conversation: the row's wrapper elevates (the
  // pill is this row's absolute child, so the wrapper's zIndex paints it
  // above later rows) and a backdrop there eats the next click to dismiss —
  // same open-until-click-away behavior as the native ⋯ menu
  effect(() => {
    onPicker?.(!!picker(), () => picker.set(""));
  });
  // the pill floats (never in-flow, so nothing shifts when it opens) and
  // flips above its bar when there is no room below — same edge rule the
  // native Menu.popup applies
  const flip = signal(false);
  let msgBar!: YNode;
  const openPicker = async (slot: string, el: YNode) => {
    if (picker() === slot) {
      picker.set("");
      return;
    }
    const m = await el?.measure();
    flip.set(!!m && m.pageY + m.height + 205 > windowSize().height - 80);
    picker.set(slot);
  };
  const hover = {
    onHoverIn: () => hov.set(true),
    onHoverOut: () => hov.set(false),
  };
  const react = (emoji: string) =>
    post("/react", { key: "idx:" + t.i, r: emoji });
  const more = () =>
    Menu.popup([
      { label: "Copy", onSelect: () => post("/copy", { text: t.text }) },
      { type: "separator" },
      {
        label: "Delete",
        onSelect: () => post("/turn/delete", { key: "idx:" + t.i }),
      },
    ]);
  // the pill hangs 6pt off its bar; the wrapper's padding bridges that gap
  // so the pointer can cross without firing the row's hover-out
  const float = (right: boolean) => (
    <View
      style={{
        position: "absolute",
        zIndex: 30,
        right: right ? 0 : undefined,
        left: right ? undefined : 0,
        top: flip() ? undefined : 24,
        bottom: flip() ? 24 : undefined,
        paddingTop: flip() ? 0 : 6,
        paddingBottom: flip() ? 6 : 0,
      }}
    >
      <EmojiPill current={t.reaction || ""} onPick={(e) => { react(e); picker.set(""); }} />
    </View>
  );
  // canReact=false on our own bubbles — reacting to yourself is nonsense;
  // the agent reacts to them through its react tool instead
  const bar = (right: boolean, canReact: boolean) => (
    <View
      ref={msgBar}
      style={{
        opacity: (hov() && !chatScrolling()) || picker() === "msg" ? 1 : 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
      }}
    >
      <If when={canReact}>
        <Act glyph="☺" title="react" onPress={() => void openPicker("msg", msgBar)} />
      </If>
      <Act glyph="↩" title="reply" onPress={() => { picker.set(""); onReply?.(t.i, t.text || t.caption || t.name); }} />
      <Act glyph="⋯" title="more" onPress={() => { picker.set(""); more(); }} />
      <If when={picker() === "msg"}>{float(right)}</If>
    </View>
  );
  // ChatGPT placement: the action bar sits below the artifact (image, file,
  // gallery), outside its container — not beside it (preview option 3).
  const artifact = (node: any, f: any) => {
    const h = signal(false);
    let artBar!: YNode;
    // each artifact in the reply gets its own pill slot — one shared "art"
    // would open the picker under every artifact at once
    const slot = "art:" + (f?.path || "gallery");
    return (
      <View
        onHoverIn={() => h.set(true)}
        onHoverOut={() => h.set(false)}
        style={{ alignSelf: "flex-start", gap: 4, maxWidth: "100%" }}
      >
        {node}
        {badge("right")}
        <View ref={artBar} style={{ opacity: (h() && !chatScrolling()) || picker() === slot ? 1 : 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
          <Act glyph="☺" title="react" onPress={() => void openPicker(slot, artBar)} />
          <Act
            glyph="↩"
            title="reply"
            onPress={() => {
              picker.set("");
              // the file(s) travel with the reply, so the model gets their contents
              const media = (t.files || []).filter((x: any) => x.kind === "image" || x.kind === "video");
              onReply?.(t.i, f ? `📎 ${f.name}` : `📎 ${media.map((x: any) => x.name).join(", ")}`, f ? [f.path] : media.map((x: any) => x.path));
            }}
          />
          <Act
            glyph="⋯"
            title="more"
            onPress={() => {
              picker.set("");
              Menu.popup([
                ...(f ? [{ label: "Open", onSelect: () => openFile(f) }, { label: "Copy file name", onSelect: () => post("/copy", { text: f.name }) }] : []),
                { label: "Copy message", onSelect: () => post("/copy", { text: t.text }) },
              ]);
            }}
          />
          <If when={picker() === slot}>{float(true)}</If>
        </View>
      </View>
    );
  };
  // iMessage tapback: the reaction floats on the bubble's top corner —
  // left on our own bubbles (the agent's reaction), right on the agent's
  const badge = (side: "left" | "right") =>
    t.reaction ? (
      <View
        onPress={() => post("/react", { key: "idx:" + t.i, r: "" })}
        activeOpacity={0.7}
        style={{
          position: "absolute",
          top: -10,
          left: side === "left" ? -10 : undefined,
          right: side === "right" ? -10 : undefined,
          zIndex: 5,
          borderRadius: 10,
          paddingHorizontal: 5,
          paddingVertical: 2,
          backgroundColor: appearance() === "dark" ? "#2b2b2b" : "#ffffff",
          borderWidth: 1,
          borderColor: tc("#f5f5f51f"),
        }}
      >
        <Text style={{ fontSize: 11 }}>{t.reaction}</Text>
      </View>
    ) : null;
  // Rows are full-width so the text inside a bubble is measured against a
  // definite width and wraps; a shrink-to-fit row would let the text run to
  // its unwrapped width and get clipped at the pane edge. Bubbles hug their
  // content up to 540pt via maxWidth.
  if (t.role === "user")
    return (
      <View style={{ alignItems: "flex-end", gap: 4, width: "100%" }} {...hover}>
      {/* attached images sit above the bubble (Grok), files as chips */}
      <If when={(t.attachments || []).length > 0}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 6, maxWidth: 560 }}>
          {(t.attachments || []).map((a: any) => (
            <FileTile a={a} size={a.kind === "file" ? 72 : 120} />
          ))}
        </View>
      </If>
      <View
        class="flex-row w-full"
        style={{ justifyContent: "flex-end" }}
      >
        {/* Sand: radius 18, padding 7×12, 14/20, the bot's bubble fill */}
        <View
          style={{
            backgroundColor: bubbleFill(),
            borderRadius: 18,
            paddingVertical: 7,
            paddingHorizontal: 12,
            maxWidth: 560,
            flexShrink: 1,
          }}
        >
          {badge("left")}
          <OnFill.Provider value={true}>
            {/* replying: the quoted message heads the bubble; it jumps there */}
            <If when={!!t.reply}>
              <View
                onPress={() => onJump?.(t.reply.i)}
                activeOpacity={0.7}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 }}
              >
                <Text style={{ color: "#ffffffb3", fontSize: 12 }}>💬︎</Text>
                <Text numberOfLines={1} style={{ flexShrink: 1, color: "#ffffffcc", fontSize: 13, lineHeight: 18 }}>
                  {`“${String(t.reply?.text || "").replace(/\s+/g, " ").slice(0, 80)}”`}
                </Text>
              </View>
            </If>
            <If when={!!t.text}>
              <Markdown text={t.text} />
            </If>
          </OnFill.Provider>
        </View>
      </View>
      {/* ChatGPT: the action bar sits under the bubble, aligned to its edge */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
        {bar(true, false)}
      </View>
      </View>
    );
  // a building artifact renders its declared placeholder — before the
  // module exists, possibly before it even has a name
  if (t.building) return <ArtPlaceholder t={t} />;
  if (!t.name)
    return (
      <View style={{ gap: 4, width: "100%" }} {...hover}>
      <View
        class="flex-row w-full"
        style={{ justifyContent: "flex-start" }}
      >
        <View
          style={{
            backgroundColor: agentFill(),
            borderRadius: 18,
            borderWidth: 1,
            borderColor: tc("#f5f5f50f"),
            paddingHorizontal: 16,
            paddingVertical: 10,
            maxWidth: 560,
            flexShrink: 1,
          }}
        >
          {badge("right")}
          <Markdown text={t.text} />
        </View>
      </View>
      {/* ChatGPT: action bar under the bubble, aligned to its left edge */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {bar(false, true)}
      </View>
      {/* files the reply produced: Grok's file cards, in the reply flow → fullscreen viewer */}
      <If when={(t.files || []).length > 0}>
        <View style={{ gap: 8, width: "100%", maxWidth: 560 }}>
          <If when={(t.files || []).some((f: any) => f.kind === "image" || f.kind === "video")}>
            {artifact(<MediaGallery files={(t.files || []).filter((f: any) => f.kind === "image" || f.kind === "video")} />, null)}
          </If>
          {(t.files || []).filter((f: any) => f.kind !== "image" && f.kind !== "video").map((f: any) =>
            f.kind === "audio" ? (
              artifact(<AudioCard f={f} onOpen={openFile} tint={bubbleFill() || tc("#f5f5f5")} />, f)
            ) : (
              artifact(<FileCard f={f} onOpen={openFile} />, f)
            ),
          )}
        </View>
      </If>
      </View>
    );
  // A card pins the version it rendered: "R6@v3" resolves that exact module;
  // cards from before versions (no t.v) resolve the bare name = current.
  const key = t.v ? `${t.name}@v${t.v}` : t.widget ? t.name + "w" : t.name;
  let C = MODULES[key];
  if (!C) {
    const d = moduleOf(key);
    if (d === "loading") return <ArtPlaceholder t={t} />;
    if (typeof d === "function") C = d;
  }
  if (!C)
    return (
      <View class="self-start px-1 py-1 flex-row items-center gap-2">
        <Text style={{ color: tc("#f5f5f566"), fontSize: 12 }}>
          {`${t.art?.title || "app"} — module missing`}
        </Text>
        <DelBtn k={"idx:" + t.i} />
      </View>
    );
  return (
    <CardShell
      name={t.name}
      v={t.v}
      title={t.art?.title || (t.label === "image" ? "Image" : "Mini app")}
      desc={t.art?.desc || ""}
      caption={t.caption}
      reaction={t.reaction}
      i={t.i}
      onReply={onReply}
      onPicker={onPicker}
    >
      <C />
    </CardShell>
  );
}

// The transcript rows (inside the app's native Scroll). Turn objects are kept
// stable by the app, so <Each> builds a row once and keeps it.
export function Conversation(props: {
  turns: any[];
  onReply?: (i: number, text: string, files?: string[]) => void;
  /** scroll to a content y (a quoted message's row) */
  onJump?: (y: number) => void;
}) {
  const rowY = new Map<number, number>();
  // whichever row opened its picker last owns this close — the backdrop's
  // first click runs it, exactly like dismissing a native menu
  const closePicker = signal<(() => void) | null>(null);
  return (
    <View class="gap-5 py-4">
      <Each of={props.turns}>
        {(t) => {
          // an open emoji pill must paint above later rows — the wrapper is
          // the sibling unit, so it carries the zIndex
          const open = signal(false);
          return (
            <View onLayout={(e) => rowY.set(t().i, e.y)} style={{ zIndex: open() ? 30 : 0 }}>
              <TurnRow
                t={t()}
                onReply={props.onReply}
                onPicker={(o, close) => {
                  open.set(o);
                  closePicker.set(o ? close : null);
                }}
                onJump={(i) => {
                  const y = rowY.get(i);
                  if (y != null) props.onJump?.(y);
                }}
              />
            </View>
          );
        }}
      </Each>
      {/* click-away layer: invisible while no picker is open; the open row
          floats above it (zIndex 30), everything else clicks here */}
      <If when={!!closePicker()}>
        <View
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, backgroundColor: "#00000001" }}
          onPress={() => {
            const c = closePicker();
            if (c) c();
          }}
          onContextMenu={() => {
            const c = closePicker();
            if (c) c();
          }}
        />
      </If>
    </View>
  );
}

type Props = {
  name: string;
  /** the version this card pinned (absent on pre-version cards) */
  v?: number | null;
  /** model-declared product name ("Tic Tac Toe") — never a file name */
  title: string;
  /** model-declared one-line description under the title */
  desc?: string;
  caption?: string;
  reaction?: string;
  i?: number;
  onReply?: (i: number, text: string, files?: string[]) => void;
  /** reports picker open/close up to the row wrapper (zIndex) + backdrop */
  onPicker?: (open: boolean, close: () => void) => void;
  children?: any;
};

export function CardShell(props: Props) {
  const reaction = signal(props.reaction || "");
  const codeOpen = signal(false);
  const source = signal("");
  const copied = signal(false);
  const published = signal(false);
  const pinned = signal(false);
  const work = signal("");
  const extra = signal("");
  const hov = signal(false);
  const pickerOpen = signal(false);
  effect(() => {
    props.onPicker?.(pickerOpen(), () => pickerOpen.set(false));
  });
  // floating pill (see TurnRow): overlays, flips up near the surface bottom
  const flip = signal(false);
  let actBar!: YNode;
  const toks = signal<[string, string, string][][] | null>(null);
  const renaming = signal(false);
  const titleSig = signal(props.title);
  // versions/head come back with the source fetch — the ⋯ menu's
  // "Version history" submenu is built from them
  const vers = signal<{ v: number; label?: string; prompt?: string }[]>([]);
  const head = signal<number | null>(null);

  // The card shows its own pinned version everywhere — code panel, reply
  // attach, pop-out; bare name only when the card predates versions.
  const modKey = `${props.name}${props.v ? `@v${props.v}` : ""}`;
  fetch(`${GEN}/pins`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.pins?.includes(props.name)) pinned.set(true);
    })
    .catch(() => {});
  fetch(`${GEN}/module?name=${modKey}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.published) published.set(true);
      if (d?.source) source.set(d.source);
      if (d?.versions) vers.set(d.versions);
      if (d?.head != null) head.set(d.head);
      if (!props.title && d?.title) titleSig.set(d.title);
    })
    .catch(() => {});

  const react = (r: string) => {
    const next = reaction() === r ? "" : r;
    reaction.set(next);
    post("/react", { name: props.name, r: next });
  };
  // Older rows stored "up"/"down" — the picker stores the emoji itself now.
  const badge = () => ({ up: "👍", down: "👎" })[reaction()] || reaction();

  const srcErr = signal(false);
  const fetchSource = async () => {
    const d = await fetch(`${GEN}/module?name=${modKey}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (d?.source) source.set(d.source);
    else srcErr.set(true);
  };

  const toggleCode = async () => {
    if (!codeOpen() && !source() && !srcErr()) await fetchSource();
    codeOpen.update((v) => !v);
  };

  // Shiki tokens for the open code panel (same /highlight endpoint the file
  // viewer uses) — fetched once, kept for the card's life
  effect(() => {
    const code = codeOpen() ? source() : "";
    if (!code || toks()) return;
    fetch(`${GEN}/highlight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, lang: "tsx" }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.lines) toks.set(d.lines);
      })
      .catch(() => {});
  });

  const copySource = async () => {
    if (!source() && !srcErr()) await fetchSource();
    const s = source();
    if (!s) return;
    post("/copy", { text: s });
    copied.set(true);
    setTimeout(() => copied.set(false), 1200);
  };

  const popout = () => {
    post("/popout", { name: props.name, ...(props.v ? { v: props.v } : {}) }).then((d) => {
      extra.set(
        d?.ok ? (d.already ? "window already open" : "↗ window opened") : "popout failed",
      );
      setTimeout(() => extra.set(""), 2000);
    });
  };

  const pin = () => {
    const next = !pinned();
    pinned.set(next);
    post("/pin", { name: props.name, pinned: next }).then((d) => {
      if (!d?.ok) pinned.set(!next);
      extra.set(next ? "★ nominated — leads the desktop widget" : "unpinned");
      setTimeout(() => extra.set(""), 2000);
    });
  };

  const publish = () => {
    if (published()) return;
    post("/publish", { name: props.name }).then((d) => {
      if (d?.ok) {
        published.set(true);
        extra.set(`saved — see the Mini Apps tab`);
        setTimeout(() => extra.set(""), 2500);
      } else {
        extra.set(d?.error || "publish failed");
        setTimeout(() => extra.set(""), 2500);
      }
    });
  };

  const unpublish = () =>
    post("/unpublish", { name: props.name }).then((d) => {
      if (d?.ok) {
        published.set(false);
        extra.set("removed from Mini Apps");
        setTimeout(() => extra.set(""), 2000);
      }
    });

  // ⋯ menu — approved order (preview option 3B): code actions · version
  // history + rename · publish/window/widget · try again · delete. No
  // Reveal in Finder, no visible delete button — both live only here.
  const more = () => {
    const items: any[] = [
      { label: codeOpen() ? "Hide Code" : "View Code", onSelect: () => { void toggleCode(); } },
      { label: "Copy Source", onSelect: () => { void copySource(); } },
    ];
    if (vers().length > 1)
      items.push({
        label: "Version history",
        submenu: vers()
          .slice()
          .reverse()
          .map((x) => ({
            label: `v${x.v}${x.v === head() ? " ✓" : ""}${x.label ? ` — ${x.label}` : x.prompt ? ` — ${String(x.prompt).replace(/\s+/g, " ").slice(0, 40)}` : ""}`,
            onSelect: () =>
              post("/app/version", { name: props.name, v: x.v }).then((d) => {
                if (d?.ok) {
                  head.set(x.v);
                  extra.set(`Library now launches v${x.v}`);
                  setTimeout(() => extra.set(""), 2000);
                }
              }),
          })),
      });
    items.push(
      { label: "Rename…", onSelect: () => renaming.set(true) },
      { type: "separator" },
      {
        label: published() ? "Remove from Mini Apps" : "Save to Mini Apps",
        onSelect: () => (published() ? unpublish() : publish()),
      },
      { label: "Open in Window", onSelect: popout },
      {
        label: pinned() ? "Unpin Desktop Widget" : "Add to Desktop Widget",
        onSelect: pin,
      },
      { type: "separator" },
      { label: "Try Again", onSelect: () => { void retry(); } },
      { type: "separator" },
      {
        label: "Delete",
        onSelect: () => post("/turn/delete", { key: "name:" + props.name }),
      },
    );
    Menu.popup(items);
  };

  // Inline title rename (⋯ → Rename…): Enter commits to /app/meta, Esc cancels.
  effect(() => {
    if (!renaming()) return;
    const off = keymap.bind({ escape: () => renaming.set(false) }, { when: "always" });
    cleanup(off);
  });
  const commitRename = (text: string) => {
    const t = String(text || "").trim().slice(0, 60);
    renaming.set(false);
    if (!t || t === titleSig()) return;
    post("/app/meta", { name: props.name, title: t }).then((d) => {
      if (!d || d.ok === false) return;
      titleSig.set(t);
      extra.set("renamed");
      setTimeout(() => extra.set(""), 1500);
    });
  };

  const retry = async () => {
    if (work()) return;
    work.set("queued");
    const d = await post("/retry", { name: props.name });
    if (!d?.id) {
      work.set("");
      return;
    }
    for (let fails = 0; ; ) {
      await new Promise((r) => setTimeout(r, 450));
      const s = await fetch(`${GEN}/status?id=${d.id}`)
        .then((x) => (x.ok ? x.json() : null))
        .catch(() => null);
      if (!s) {
        if (++fails > 15) break;
        continue;
      }
      fails = 0;
      work.set(s.detail || s.phase);
      if (s.done) break;
    }
    work.set("");
  };

  return (
    <View
      class="self-stretch"
      style={{ zIndex: pickerOpen() ? 30 : 0 }}
      onHoverIn={() => hov.set(true)}
      onHoverOut={() => hov.set(false)}
    >
      <View
        class="self-stretch rounded-2xl p-3"
        style={{
          backgroundColor: tc("#1f1f1f"),
          borderWidth: 1,
          borderColor: tc("#f5f5f50f"),
        }}
      >
      {/* header: the model's product title + version chip — no file names
          (preview option 4B). ⋯ → Rename… swaps the title for an input. */}
      <View class="flex-row items-center gap-2" style={{ minHeight: 22 }}>
        {renaming() ? (
          <Input
            defaultValue={titleSig()}
            autoFocus
            onSubmitEditing={(e) => commitRename(e.text)}
            onBlur={() => renaming.set(false)}
            style={{ flex: 1, fontSize: 14, fontWeight: "600", color: tc("#f5f5f5") }}
          />
        ) : (
          <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 14, fontWeight: "600", flexShrink: 1 }}>
            {titleSig() || "Mini app"}
          </Text>
        )}
        <If when={!!props.v}>
          <Text
            style={{
              fontSize: 10.5,
              color: tc("#f5f5f585"),
              backgroundColor: tc("#f5f5f514"),
              paddingHorizontal: 6,
              paddingVertical: 1,
              borderRadius: 7,
              overflow: "hidden",
            }}
          >
            {`v${props.v}`}
          </Text>
        </If>
      </View>
      <If when={!!props.desc}>
        <Text numberOfLines={2} style={{ color: tc("#f5f5f5a8"), fontSize: 12, marginTop: 2 }}>
          {props.desc || ""}
        </Text>
      </If>

      <If when={!!props.caption}>
        <View class="pb-1 pt-1">
          <Markdown text={props.caption || ""} />
        </View>
      </If>

      {props.children}

      <If when={codeOpen()}>
        <View
          class="mt-2 rounded-lg"
          style={{
            backgroundColor: tc("#121212"),
            borderWidth: 1,
            borderColor: tc("#f5f5f514"),
            overflow: "hidden",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 10,
              paddingVertical: 6,
              backgroundColor: tc("#f5f5f50f"),
            }}
          >
            <Text
              style={{ color: tc("#f5f5f585"), fontSize: 11, fontFamily: "Menlo" }}
            >
              {`${props.name}.tsx`}
            </Text>
            <View onPress={copySource} activeOpacity={0.7}>
              <Text style={{ color: tc("#f5f5f585"), fontSize: 11 }}>
                {copied() ? "✓ copied" : "⧉ copy"}
              </Text>
            </View>
          </View>
          <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
            <If when={srcErr()}>
              <Text style={{ color: tc("#f5f5f566"), fontSize: 11.5 }}>
                source unavailable — artifact was deleted
              </Text>
            </If>
            <If when={!srcErr() && !toks()}>
              <Text
                style={{
                  fontFamily: "Menlo",
                  fontSize: 11.5,
                  color: tc("#f5f5f5a8"),
                  lineHeight: 17,
                }}
              >
                {source() || "…"}
              </Text>
            </If>
            <If when={!srcErr() && !!toks()}>
              <Scroll style={{ maxHeight: 380 }}>
                <Scroll horizontal contentContainerStyle={{ flexDirection: "column" }}>
                  {(toks() || []).map((line, i) => (
                    <View style={{ flexDirection: "row", minHeight: 18 }}>
                      <Text style={{ width: 30, textAlign: "right", paddingRight: 10, color: tc("#f5f5f53d"), fontFamily: "Menlo", fontSize: 10.5, lineHeight: 18 }}>
                        {String(i + 1)}
                      </Text>
                      <Text style={{ fontFamily: "Menlo", fontSize: 11.5, lineHeight: 18, color: tc("#f5f5f5") }}>
                        {line.map(([s, d, l]) => (
                          <Text style={{ color: (appearance() === "dark" ? d : l) || tc("#f5f5f5a8") }}>{s}</Text>
                        ))}
                      </Text>
                    </View>
                  ))}
                </Scroll>
              </Scroll>
            </If>
          </View>
        </View>
      </If>

      </View>

      {/* ChatGPT: the action bar lives OUTSIDE and BELOW the card (preview
          option 3). Status text on the left, the same ☺ ↩ ⋯ as messages on
          the right, revealed on hover. */}
      <View class="mt-1.5 flex-row items-center justify-between" style={{ minHeight: 24 }}>
        <View class="flex-row items-center gap-2">
          <If when={!!reaction()}>
            <Text style={{ fontSize: 13 }}>{badge()}</Text>
          </If>
          <If when={!!work()}>
            <Text style={{ color: tc("#f5f5f585"), fontSize: 11 }}>
              {work()}
            </Text>
          </If>
          <If when={!!extra()}>
            <Text style={{ color: "#32bb78", fontSize: 11 }}>{extra()}</Text>
          </If>
        </View>
        <View ref={actBar} style={{ opacity: (hov() && !chatScrolling()) || pickerOpen() ? 1 : 0, flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Act
            glyph="☺"
            title="react"
            onPress={() => {
              if (pickerOpen()) {
                pickerOpen.set(false);
                return;
              }
              void actBar?.measure().then((m) => {
                flip.set(!!m && m.pageY + m.height + 205 > windowSize().height - 80);
                pickerOpen.set(true);
              });
            }}
          />
          <Act
            glyph="↩"
            title="reply"
            onPress={() => {
              pickerOpen.set(false);
              props.onReply?.(props.i ?? 0, `app · ${titleSig() || props.name}${props.v ? ` v${props.v}` : ""}`, [
                `module://${modKey}`,
              ]);
            }}
          />
          <Act glyph="⋯" title="more" onPress={() => { pickerOpen.set(false); more(); }} />
          <If when={pickerOpen()}>
            <View
              style={{
                position: "absolute",
                zIndex: 30,
                right: 0,
                top: flip() ? undefined : 24,
                bottom: flip() ? 24 : undefined,
                paddingTop: flip() ? 0 : 6,
                paddingBottom: flip() ? 6 : 0,
              }}
            >
              <EmojiPill current={reaction()} onPick={(e) => { react(e); pickerOpen.set(false); }} />
            </View>
          </If>
        </View>
      </View>
    </View>
  );
}
