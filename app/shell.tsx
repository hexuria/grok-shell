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

// the scroll-idle flag lives in ./scroll (md.tsx and fileviewer.tsx read it
// too — importing it from here would cycle); re-exported for App.tsx
import { chatScrolling } from "./scroll";
export { chatScrolling };

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
export function EmojiPill(props: { current: string; onPick: (e: string) => void }) {
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

// One conversation row: user bubble / markdown reply / app card. `t` is the
// list cell's item memo — the row's whole content is one tracked computation
// over `t()`, so a rebound cell rebuilds the subtree for the new turn while
// cell-scoped state (hover, picker, bar refs) lives outside it.
// Hovering a bubble reveals the action pill (react / reply / more); ⋯ opens
// the native context menu, which the OS flips up or down to stay on screen.
function TurnRow({ t, onReply, onJump, onPicker }: {
  t: () => any;
  onReply?: (i: number, text: string, files?: string[]) => void;
  onJump?: (i: number) => void;
  onPicker?: (open: boolean, close: () => void) => void;
}) {
  const hov = signal(false);
  // which bar opened the emoji pill: "msg" or "art:<file path>"
  const picker = signal("");
  // the anchor this row put into the shared pill overlay — cleared only if
  // still ours (a newer owner already replaced it)
  let myAnchor: PillAnchor | null = null;
  // reports open/close up to the cell: the shared pickerClose dismisses on
  // click-away — same open-until-click-away behavior as the native ⋯ menu.
  const closeP = () => {
    picker.set("");
    if (myAnchor && pillAnchor() === myAnchor) pillAnchor.set(null);
    myAnchor = null;
  };
  effect(() => {
    onPicker?.(!!picker(), closeP);
  });
  // rebind: the recycled cell drops the previous turn's transient state
  let lastI = -1;
  effect(() => {
    const i = t()?.i ?? -1;
    if (i !== lastI) {
      lastI = i;
      hov.set(false);
      if (picker()) closeP();
    }
  });
  let msgBar!: YNode;
  const openPicker = async (slot: string, el: YNode, right: boolean) => {
    if (picker() === slot) {
      closeP();
      return;
    }
    const a = await openPill(el, right, t().reaction || "", (e) => {
      react(e);
      closeP();
    });
    if (a) {
      myAnchor = a;
      picker.set(slot);
    }
  };
  const hover = {
    onHoverIn: () => hov.set(true),
    onHoverOut: () => hov.set(false),
  };
  const react = (emoji: string) =>
    post("/react", { key: "idx:" + t().i, r: emoji });
  const more = () =>
    Menu.popup([
      { label: "Copy", onSelect: () => post("/copy", { text: t().text }) },
      { type: "separator" },
      {
        label: "Delete",
        onSelect: () => post("/turn/delete", { key: "idx:" + t().i }),
      },
    ]);
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
        <Act glyph="☺" title="react" onPress={() => void openPicker("msg", msgBar, right)} />
      </If>
      <Act glyph="↩" title="reply" onPress={() => { closeP(); onReply?.(t().i, t().text || t().caption || t().name); }} />
      <Act glyph="⋯" title="more" onPress={() => { closeP(); more(); }} />
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
          <Act glyph="☺" title="react" onPress={() => void openPicker(slot, artBar, true)} />
          <Act
            glyph="↩"
            title="reply"
            onPress={() => {
              closeP();
              // the file(s) travel with the reply, so the model gets their contents
              const media = (t().files || []).filter((x: any) => x.kind === "image" || x.kind === "video");
              onReply?.(t().i, f ? `📎 ${f.name}` : `📎 ${media.map((x: any) => x.name).join(", ")}`, f ? [f.path] : media.map((x: any) => x.path));
            }}
          />
          <Act
            glyph="⋯"
            title="more"
            onPress={() => {
              closeP();
              Menu.popup([
                ...(f ? [{ label: "Open", onSelect: () => openFile(f) }, { label: "Copy file name", onSelect: () => post("/copy", { text: f.name }) }] : []),
                { label: "Copy message", onSelect: () => post("/copy", { text: t().text }) },
              ]);
            }}
          />
        </View>
      </View>
    );
  };
  // iMessage tapback (measured off Grok's render): a 30pt dark circle with a
  // 1px lighter rim, horizontally centered on the bubble's outer top corner.
  // Grok punches a ~3pt ring of page color through the bubble around the
  // badge — a knockout hole — so we paint a concentric page-colored disc
  // under it (invisible over the page, cuts the bubble where they overlap).
  const badge = (side: "left" | "right") =>
    t().reaction ? (
      <View
        style={{
          position: "absolute",
          top: -27,
          left: side === "left" ? -18 : undefined,
          right: side === "right" ? -18 : undefined,
          zIndex: 5,
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tc("#161616"),
        }}
      >
        <View
          onPress={() => post("/react", { key: "idx:" + t().i, r: "" })}
          activeOpacity={0.7}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: appearance() === "dark" ? "#242424" : "#ffffff",
            borderWidth: 1,
            borderColor: appearance() === "dark" ? "#353535" : "#d4d4d8",
          }}
        >
          <Text style={{ fontSize: 14 }}>{t().reaction}</Text>
        </View>
      </View>
    ) : null;
  // Rows are full-width so the text inside a bubble is measured against a
  // definite width and wraps; a shrink-to-fit row would let the text run to
  // its unwrapped width and get clipped at the pane edge. Bubbles hug their
  // content up to 540pt via maxWidth. The branch pick, the file maps and the
  // module resolution all read `t()` inside the dynamic child, so a rebound
  // cell swaps the whole subtree — no stale turn can survive a recycle.
  return (
    <View style={{ width: "100%" }}>
      {() => {
        const tt = t();
        if (!tt) return null;
        if (tt.role === "user")
          return (
            <View style={{ alignItems: "flex-end", gap: 4, width: "100%" }} {...hover}>
            {/* attached images sit above the bubble (Grok), files as chips */}
            <If when={(tt.attachments || []).length > 0}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 6, maxWidth: 560 }}>
                {(tt.attachments || []).map((a: any) => (
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
                  <If when={!!tt.reply}>
                    <View
                      onPress={() => onJump?.(tt.reply.i)}
                      activeOpacity={0.7}
                      style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 2 }}
                    >
                      <Text style={{ color: "#ffffffb3", fontSize: 12 }}>💬︎</Text>
                      <Text numberOfLines={1} style={{ flexShrink: 1, color: "#ffffffcc", fontSize: 13, lineHeight: 18 }}>
                        {`“${String(tt.reply?.text || "").replace(/\s+/g, " ").slice(0, 80)}”`}
                      </Text>
                    </View>
                  </If>
                  <If when={!!tt.text}>
                    <Markdown text={tt.text} />
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
        if (tt.building) return <ArtPlaceholder t={tt} />;
        if (!tt.name)
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
                <Markdown text={tt.text} />
              </View>
            </View>
            {/* ChatGPT: action bar under the bubble, aligned to its left edge */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {bar(false, true)}
            </View>
            {/* files the reply produced: Grok's file cards, in the reply flow → fullscreen viewer */}
            <If when={(tt.files || []).length > 0}>
              <View style={{ gap: 8, width: "100%", maxWidth: 560 }}>
                <If when={(tt.files || []).some((f: any) => f.kind === "image" || f.kind === "video")}>
                  {artifact(<MediaGallery files={(tt.files || []).filter((f: any) => f.kind === "image" || f.kind === "video")} />, null)}
                </If>
                {(tt.files || []).filter((f: any) => f.kind !== "image" && f.kind !== "video").map((f: any) =>
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
        // A card pins the version it rendered: "R6@v3" resolves that exact
        // module; cards from before versions (no t.v) resolve the bare name =
        // current. Runtime chunks win over the bundled MODULES: the packaged
        // app's registry is frozen at build time while the server keeps
        // numbering new modules — a name collision (data-dir R17 vs bundled
        // R17) must render the fresh chunk, not the stale bundled module.
        const key = tt.v ? `${tt.name}@v${tt.v}` : tt.widget ? tt.name + "w" : tt.name;
        const d = moduleOf(key);
        if (d === "loading") return <ArtPlaceholder t={tt} />;
        const C = (typeof d === "function" ? d : null) ?? MODULES[key];
        if (!C)
          return (
            <View class="self-start px-1 py-1 flex-row items-center gap-2">
              <Text style={{ color: tc("#f5f5f566"), fontSize: 12 }}>
                {`${tt.art?.title || "app"} — module missing`}
              </Text>
              <DelBtn k={"idx:" + tt.i} />
            </View>
          );
        return (
          <CardShell
            name={tt.name}
            v={tt.v}
            title={tt.art?.title || (tt.label === "image" ? "Image" : "Mini app")}
            desc={tt.art?.desc || ""}
            art={tt.art}
            caption={tt.caption}
            reaction={tt.reaction}
            i={tt.i}
            onReply={onReply}
            onPicker={onPicker}
          >
            <C />
          </CardShell>
        );
      }}
    </View>
  );
}

// The open emoji pill's close fn — owned by whichever row opened last and
// cleared only by that owner (a sibling row reporting "closed" must not wipe
// it). The window root dismisses on any touch that didn't land on the pill:
// capture resets the guard, the pill's own touch marks it, and the root's
// bubble-phase handler closes only when unmarked — no overlay, so hovers and
// clicks reach every surface (sidebar, details, composer) like a native menu.
export const pickerClose = signal<(() => void) | null>(null);
export const pillGuard = { touch: false };

// The pill itself renders above the whole list as one app-level overlay —
// list cells recycle, so an in-cell pill could be covered by a later cell.
// `pillAnchor` carries the measured bar rect (page coords), the flip, the
// row's emoji state and its pick handler; identity-compared so a stale owner
// can't clear a newer anchor.
export type PillAnchor = {
  x: number; y: number; w: number; h: number;
  flip: boolean; right: boolean;
  current: string; onPick: (e: string) => void;
};
export const pillAnchor = signal<PillAnchor | null>(null);

/** Measure `el` and open the shared pill anchored to it; returns the anchor
 * (null when the bar isn't in the tree). */
export async function openPill(
  el: YNode | undefined,
  right: boolean,
  current: string,
  onPick: (e: string) => void,
): Promise<PillAnchor | null> {
  const m = await el?.measure();
  if (!m) return null;
  const flip = m.pageY + m.height + 205 > windowSize().height - 80;
  const anchor = { x: m.pageX, y: m.pageY, w: m.width, h: m.height, flip, right, current, onPick };
  pillAnchor.set(anchor);
  return anchor;
}

// One transcript cell inside the app's virtualized <List>. Cells recycle:
// `t` is the list's item memo — every read goes through `t()` so a rebound
// cell draws the new turn, and picker ownership is released only when this
// cell still owns it (a recycled cell must not clear a newer owner's state).
export function TurnCell(props: {
  t: () => any;
  onReply?: (i: number, text: string, files?: string[]) => void;
  onJump?: (i: number) => void;
}) {
  let owned: (() => void) | null = null;
  cleanup(() => {
    if (owned && pickerClose() === owned) {
      pickerClose.set(null);
      pillAnchor.set(null);
    }
  });
  return (
    <View style={{ alignSelf: "center", width: "100%", maxWidth: 992, paddingHorizontal: 16 }}>
      <TurnRow
        t={props.t}
        onReply={props.onReply}
        onPicker={(o, close) => {
          if (o) {
            // a new owner dismisses whatever pill was open before it;
            // the displaced row's "closed" report sees the new owner
            // and leaves it alone
            owned = close;
            const prev = pickerClose();
            pickerClose.set(close);
            if (prev && prev !== close) prev();
          } else if (pickerClose() === close) pickerClose.set(null);
        }}
        onJump={props.onJump}
      />
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
  /** model-declared card geometry: the size the app was designed for */
  art?: { w?: number; h?: number } | null;
  caption?: string;
  reaction?: string;
  i?: number;
  onReply?: (i: number, text: string, files?: string[]) => void;
  /** reports picker open/close up to the row wrapper (zIndex) + backdrop */
  onPicker?: (open: boolean, close: () => void) => void;
  children?: any;
};

// measured app heights by module key — a recycled cell frames its card at
// the right size on the first layout instead of shrinking to the declared h
// then growing when the app measures (the shift would jank the scroll)
const cardHeights = new Map<string, number>();

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
  let myAnchor: PillAnchor | null = null;
  const closeP = () => {
    pickerOpen.set(false);
    if (myAnchor && pillAnchor() === myAnchor) pillAnchor.set(null);
    myAnchor = null;
  };
  effect(() => {
    props.onPicker?.(pickerOpen(), closeP);
  });
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

  // Height hugs the app's real content — same contract as the pop-out
  // (mount unbounded, measure, then size). Declared h is only the guess
  // before the first layout: fixed-size scenes (Tic Tac Toe's wrap grid
  // is ~535 at width 340, not the declared 480) would clip otherwise.
  // When the natural box exceeds the chat caps the whole app scales down
  // uniformly around its top-left — aspect preserved, nothing cut.
  const dw = props.art?.w || 480;
  const dh = props.art?.h || Math.round(dw * 0.75);
  const avail = signal(0); // measured column width; 0 until onLayout
  // seeded from the shared cache: a rebound cell frames at the app's real
  // height immediately instead of declared-then-grow layout shift
  const natH = signal(cardHeights.get(modKey) ?? 0);
  // a recycled cell built mid-scroll mounts light: the app itself (a JS
  // component eval + layout, unbounded cost) waits for the scroll to settle;
  // once mounted it stays — a live app must not reset or vanish mid-scroll
  const appOk = signal(!chatScrolling());
  effect(() => {
    if (!chatScrolling()) appOk.set(true);
  });
  const fit = () => Math.min(1, 560 / dw, 560 / (natH() || dh), avail() ? (avail() - 24) / dw : 1);
  const iw = () => Math.max(140, Math.round(dw * fit()));
  const ih = () => Math.round((natH() || dh) * fit());
  return (
    <View class="self-stretch" onLayout={(e) => avail.set(e.width)}>
    <View
      class="self-start"
      style={{ width: iw() + 24, maxWidth: "100%" }}
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
      {/* same tapback as message bubbles: 30pt rimmed circle on the card's
          top-right corner inside a page-colored knockout disc; tapping it
          clears the reaction */}
      <If when={!!reaction()}>
        <View
          style={{
            position: "absolute",
            top: -27,
            right: -18,
            zIndex: 5,
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tc("#161616"),
          }}
        >
          <View
            onPress={() => react("")}
            activeOpacity={0.7}
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: appearance() === "dark" ? "#242424" : "#ffffff",
              borderWidth: 1,
              borderColor: appearance() === "dark" ? "#353535" : "#d4d4d8",
            }}
          >
            <Text style={{ fontSize: 14 }}>{badge()}</Text>
          </View>
        </View>
      </If>
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

      {/* the app lays out at declared width with unbounded height — the
          inner view measures its natural height (pop-out parity), the frame
          hugs it, and oversize scenes scale down whole, never clip */}
      <View style={{ width: iw(), height: ih(), borderRadius: 10, overflow: "hidden" }}>
        <If when={appOk()}>
          <View style={{ width: dw, transform: [{ scale: fit() }], transformOrigin: "top left" }}>
            <View
              onLayout={(e) => {
                natH.set(e.height);
                cardHeights.set(modKey, e.height);
              }}
            >
              {props.children}
            </View>
          </View>
        </If>
      </View>

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
                closeP();
                return;
              }
              void openPill(actBar, true, reaction(), (e) => {
                react(e);
                closeP();
              }).then((a) => {
                if (a) {
                  myAnchor = a;
                  pickerOpen.set(true);
                }
              });
            }}
          />
          <Act
            glyph="↩"
            title="reply"
            onPress={() => {
              closeP();
              props.onReply?.(props.i ?? 0, `app · ${titleSig() || props.name}${props.v ? ` v${props.v}` : ""}`, [
                `module://${modKey}`,
              ]);
            }}
          />
          <Act glyph="⋯" title="more" onPress={() => { closeP(); more(); }} />
        </View>
      </View>
    </View>
    </View>
  );
}
