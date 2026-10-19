import { signal, Text, View } from "nsh";
import { FileTile } from "./filetile";
import { AudioCard, FileCard, MediaGallery, openFile } from "./fileviewer";
import { appearance, bubbleFill, OnFill, tc, tg } from "./theme";

// Grok's agent bubble: the base color at 6% (bubbleAgent 0f): a light grey on
// the light pane, not white
const agentFill = () => (appearance() === "light" ? "#0000000f" : tc("#1f1f1f"));
import { Menu } from "nsh/desktop";
import { Markdown } from "./md";
import { MODULES } from "./generated/index";

// ChatGPT-style action row + chrome around every generated widget.
//   👍 👎  persist a reaction   ·   ↻ regenerate in place (rewrites this module)
//   </> view/copy the module's own source   ·   ⤴ reveal the file in Finder
//   ⧉ copy the widget's TSX source to the clipboard

const GEN = "http://127.0.0.1:8787";

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

// One conversation row: user bubble / markdown reply / app card. Turns arrive
// as plain JSON from GET /turns — switching threads swaps data, no rebuild.
// Hovering a bubble reveals the action pill (react / reply / more); ⋯ opens
// the native context menu, which the OS flips up or down to stay on screen.
function TurnRow({ t, onReply, onJump }: {
  t: any;
  onReply?: (i: number, text: string, files?: string[]) => void;
  onJump?: (i: number) => void;
}) {
  const hov = signal(false);
  const hover = {
    onHoverIn: () => hov.set(true),
    onHoverOut: () => hov.set(false),
  };
  const react = (emoji: string) =>
    post("/react", { key: "idx:" + t.i, r: emoji });
  const pickEmoji = () =>
    Menu.popup(["👍", "❤️", "😂", "😮", "👎"].map((e) => ({
      label: e + (t.reaction === e ? " ✓" : ""),
      onSelect: () => react(t.reaction === e ? "" : e),
    })));
  const more = () =>
    Menu.popup([
      { label: "Copy", onSelect: () => post("/copy", { text: t.text }) },
      { type: "separator" },
      {
        label: "Delete",
        onSelect: () => post("/turn/delete", { key: "idx:" + t.i }),
      },
    ]);
  const bar = (
    <View
      style={{
        opacity: hov() ? 1 : 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
      }}
    >
      <Act glyph="☺" title="react" onPress={pickEmoji} />
      <Act glyph="↩" title="reply" onPress={() => onReply?.(t.i, t.text || t.caption || t.name)} />
      <Act glyph="⋯" title="more" onPress={more} />
    </View>
  );
  // Grok: every artifact under a reply reveals the same actions on hover, to
  // its right (react · reply quoting the file · more)
  const artifact = (node: any, f: any) => {
    const h = signal(false);
    return (
      <View onHoverIn={() => h.set(true)} onHoverOut={() => h.set(false)} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
        {node}
        <View style={{ opacity: h() ? 1 : 0, flexDirection: "row", alignItems: "center", gap: 2 }}>
          <Act glyph="☺" title="react" onPress={pickEmoji} />
          <Act
            glyph="↩"
            title="reply"
            onPress={() => {
              // the file(s) travel with the reply, so the model gets their contents
              const media = (t.files || []).filter((x: any) => x.kind === "image" || x.kind === "video");
              onReply?.(t.i, f ? `📎 ${f.name}` : `📎 ${media.map((x: any) => x.name).join(", ")}`, f ? [f.path] : media.map((x: any) => x.path));
            }}
          />
          <Act
            glyph="⋯"
            title="more"
            onPress={() =>
              Menu.popup([
                ...(f ? [{ label: "Open", onSelect: () => openFile(f) }, { label: "Copy file name", onSelect: () => post("/copy", { text: f.name }) }] : []),
                { label: "Copy message", onSelect: () => post("/copy", { text: t.text }) },
              ])
            }
          />
        </View>
      </View>
    );
  };
  const badge = t.reaction ? (
    <Text
      style={{
        fontSize: 13,
        backgroundColor: tc("#1f1f1f"),
        borderWidth: 1,
        borderColor: tc("#f5f5f514"),
        borderRadius: 999,
        paddingHorizontal: 5,
        overflow: "hidden",
      }}
    >
      {t.reaction}
    </Text>
  ) : null;
  // Rows are full-width so the text inside a bubble is measured against a
  // definite width and wraps; a shrink-to-fit row would let the text run to
  // its unwrapped width and get clipped at the pane edge. Bubbles hug their
  // content up to 540pt via maxWidth.
  if (t.role === "user")
    return (
      <View style={{ alignItems: "flex-end", gap: 6, width: "100%" }}>
      {/* attached images sit above the bubble (Grok), files as chips */}
      <If when={(t.attachments || []).length > 0}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 6, maxWidth: 560 }}>
          {(t.attachments || []).map((a: any) => (
            <FileTile a={a} size={a.kind === "file" ? 72 : 120} />
          ))}
        </View>
      </If>
      <View
        class="flex-row items-center gap-1.5 w-full"
        style={{ justifyContent: "flex-end" }}
        {...hover}
      >
        {bar}
        {badge}
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
      </View>
    );
  if (!t.name)
    return (
      <View style={{ gap: 8, width: "100%" }}>
      <View
        class="flex-row items-center gap-1.5 w-full"
        style={{ justifyContent: "flex-start" }}
        {...hover}
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
          <Markdown text={t.text} />
        </View>
        {badge}
        {bar}
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
  const C = MODULES[t.widget ? t.name + "w" : t.name];
  if (!C)
    return (
      <View class="self-start px-1 py-1 flex-row items-center gap-2">
        <Text style={{ color: tc("#f5f5f566"), fontSize: 12 }}>
          {`app · ${t.name} — module missing`}
        </Text>
        <DelBtn k={"idx:" + t.i} />
      </View>
    );
  const label = t.widget
    ? `app · ${t.name}.tsx`
    : `generated · ${t.name}.tsx · ${t.label}${t.retries ? ` · ↻${t.retries}` : ""}`;
  return (
    <CardShell
      name={t.name}
      label={label}
      caption={t.caption}
      reaction={t.reaction}
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
  return (
    <View class="gap-5 py-4">
      <Each of={props.turns}>
        {(t) => (
          <View onLayout={(e) => rowY.set(t().i, e.y)}>
            <TurnRow
              t={t()}
              onReply={props.onReply}
              onJump={(i) => {
                const y = rowY.get(i);
                if (y != null) props.onJump?.(y);
              }}
            />
          </View>
        )}
      </Each>
    </View>
  );
}

type Props = {
  name: string;
  label: string;
  caption?: string;
  reaction?: string;
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

  fetch(`${GEN}/pins`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.pins?.includes(props.name)) pinned.set(true);
    })
    .catch(() => {});

  const react = (r: string) => {
    const next = reaction() === r ? "" : r;
    reaction.set(next);
    post("/react", { name: props.name, r: next });
  };

  const toggleCode = async () => {
    if (!codeOpen() && !source()) {
      const d = await fetch(`${GEN}/module?name=${props.name}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (d?.source) source.set(d.source);
    }
    codeOpen.update((v) => !v);
  };

  const copySource = () => {
    const s = source();
    if (!s) return;
    post("/copy", { text: s });
    copied.set(true);
    setTimeout(() => copied.set(false), 1200);
  };

  const share = () => post("/share", { name: props.name }).then(() => {
    extra.set("revealed in Finder");
    setTimeout(() => extra.set(""), 1500);
  });

  const popout = () => {
    post("/popout", { name: props.name }).then((d) => {
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

  const btn = (icon: string, fn: () => void, active = false, title = "") => (
    <View
      onPress={fn}
      activeOpacity={0.7}
      accessibilityLabel={title}
      style={{
        borderRadius: 8,
        paddingHorizontal: 7,
        paddingVertical: 4,
        backgroundColor: active ? tc("#f5f5f514") : "transparent",
      }}
    >
      <Text style={{ color: active ? tc("#f5f5f5") : tc("#f5f5f585"), fontSize: 13 }}>
        {icon}
      </Text>
    </View>
  );

  return (
    <View
      class="self-stretch rounded-2xl p-3"
      style={{
        backgroundColor: tc("#1f1f1f"),
        borderWidth: 1,
        borderColor: tc("#f5f5f50f"),
      }}
    >
      <View class="flex-row items-center justify-between">
        <Text
          class="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: tc("#f5f5f566") }}
        >
          {props.label}
        </Text>
        <View class="flex-row items-center gap-1">
          {btn("⤴", share, false, "reveal in Finder")}
          <DelBtn k={"name:" + props.name} />
        </View>
      </View>

      <If when={!!props.caption}>
        <View class="pb-1">
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
          </View>
        </View>
      </If>

      <View class="mt-2 flex-row items-center gap-1">
        {btn("👍", () => react("up"), reaction() === "up", "good")}
        {btn("👎", () => react("down"), reaction() === "down", "bad")}
        {btn("↻", retry, !!work(), "try again")}
        {btn("</>", () => toggleCode(), codeOpen(), "view source")}
        {btn("⧉", copySource, copied(), "copy source")}
        {btn(published() ? "✓ saved" : "save", publish, published(), "publish to Mini Apps")}
        {btn("★", pin, pinned(), "nominate for the desktop widget")}
        {btn("↗", popout, false, "open in its own window")}
        <If when={!!work()}>
          <Text style={{ color: tc("#f5f5f585"), fontSize: 11 }}>
            {work()}
          </Text>
        </If>
        <If when={!!extra()}>
          <Text style={{ color: "#32bb78", fontSize: 11 }}>{extra()}</Text>
        </If>
      </View>
    </View>
  );
}
