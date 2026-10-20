// The model picker, ChatGPT / Codex style: a pill ("GPT-6 Astra Ultra ⌄")
// opens the effort card (⚡ fast toggle, effort name, "model ›", reset, a
// stepped slider that turns violet at Ultra); "model ›" opens the model
// list. The catalog is opencodex's (GET /models on the generation server).
import { Scroll, signal, Text, View, type YNode } from "nsh";
import { PanResponder } from "nsh/gesture";
import { windowSize } from "nsh/device";
import { keymap } from "nsh/keymap";
import { effect, cleanup } from "nsh";
import { Animated, createNativeValue, Easing } from "nsh/animated";
import { tc } from "./theme";

const GEN = "http://127.0.0.1:8787";

export type Choice = { model: string; effort: string; fast: boolean };
type Model = {
  id: string;
  owner: string;
  fast: boolean;
  efforts: { value: string; label: string }[];
  defaultEffort: string;
};

export const models = signal<Model[]>([]);
export const defaultModel = signal("");
export const loadModels = () =>
  fetch(`${GEN}/models`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d) return;
      models.set(d.models || []);
      defaultModel.set(d.default || "");
    })
    .catch(() => {});

// "gpt-6.1-sol" → "GPT-6.1 Sol", "xai/grok-4.6" → "Grok 4.6"; other
// providers' routes show as-is, as Codex lists them.
export function prettyModel(id: string): string {
  if (!id) return "Default";
  const [ns, rest] = id.includes("/") ? id.split("/", 2) : ["", id];
  if (ns && ns.toLowerCase() !== "xai") return id;
  const parts = rest.split("-");
  if (parts[0] === "gpt") return `GPT-${parts[1]}` + parts.slice(2).map((p) => " " + p[0].toUpperCase() + p.slice(1)).join("");
  return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
}
const modelOf = (id: string) => models().find((m) => m.id === id);
const effortLabel = (c: Choice) => modelOf(c.model)?.efforts.find((e) => e.value === c.effort)?.label ?? "";
// Codex: the model's top effort (Ultra, or Max where that is the last rung)
// is the special one — violet label, gradient fill with shimmer + sparkles.
const isTop = (c: Choice) => {
  const ef = modelOf(c.model)?.efforts ?? [];
  return ef.length > 1 && ef[ef.length - 1].value === c.effort;
};
const TOP_TINT = "#a78bfa";

type Anchor = { x: number; y: number; w: number; h: number };
const open = signal<{ mode: "effort" | "list"; at: Anchor } | null>(null);

/** The trigger: model name + effort, a chevron. */
export function ModelPill(props: { choice: () => Choice; compact?: boolean }) {
  let node!: YNode;
  return (
    <View
      ref={node}
      onPress={async () => {
        if (!models().length) loadModels();
        const m = await node.measure();
        if (m) open.set({ mode: props.choice().model ? "effort" : "list", at: { x: m.pageX, y: m.pageY, w: m.width, h: m.height } });
      }}
      activeOpacity={0.7}
      accessibilityLabel="Select model"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 28,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: open() ? tc("#f5f5f514") : tc("#f5f5f50a"),
      }}
    >
      <Text numberOfLines={1} style={{ color: tc("#f5f5f5e6"), fontSize: 12, lineHeight: 16 }}>
        {prettyModel(props.choice().model)}
      </Text>
      <If when={!!effortLabel(props.choice())}>
        <Text style={{ color: isTop(props.choice()) ? TOP_TINT : tc("#f5f5f58a"), fontSize: 12, lineHeight: 16 }}>
          {effortLabel(props.choice())}
        </Text>
      </If>
      <Text style={{ color: tc("#f5f5f58a"), fontSize: 10, marginLeft: 1 }}>⌄</Text>
    </View>
  );
}

const W = 222, TRACK = 200, KNOB = 22;

/** The popover (effort card or model list), rendered once at the root. */
// sparkle seeds [x (0..1 of the fill), y (0..1 of the track), size]
const SPARKS: [number, number, number][] = [
  [0.06, 0.3, 2], [0.14, 0.7, 1.5], [0.22, 0.4, 2.5], [0.31, 0.75, 1.5], [0.38, 0.25, 2],
  [0.47, 0.6, 1.5], [0.55, 0.35, 2.5], [0.63, 0.72, 2], [0.71, 0.3, 1.5], [0.8, 0.55, 2],
];

export function ModelPopover(props: { choice: () => Choice; setChoice: (c: Choice) => void }) {
  const hover = signal("");
  // top-effort effects: a 2.4s shimmer sweep, sparkles twinkling out of phase
  const shimmer = createNativeValue(0);
  const twinkle = [0, 1, 2, 3].map(() => createNativeValue(0.2));
  effect(() => {
    if (!open() || !isTop(props.choice())) return;
    const sweep = Animated.loop(Animated.sequence([
      Animated.timing(shimmer, { toValue: 1, duration: 2400, easing: Easing.bezier(0.42, 0, 0.58, 1) }),
      Animated.timing(shimmer, { toValue: 0, duration: 0 }),
    ]));
    sweep.start();
    const loops = twinkle.map((v, k) => {
      const l = Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 600 + k * 170 }),
        Animated.timing(v, { toValue: 0.15, duration: 700 + k * 130 }),
      ]));
      return l;
    });
    const timers = loops.map((l, k) => setTimeout(() => l.start(), k * 260));
    cleanup(() => {
      sweep.stop();
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    });
  });
  effect(() => {
    if (!open()) return;
    const off = keymap.bind("escape", () => open.set(null));
    cleanup(off);
  });
  const efforts = () => modelOf(props.choice().model)?.efforts ?? [];
  const idx = () => Math.max(0, efforts().findIndex((e) => e.value === props.choice().effort));
  const step = () => (TRACK - KNOB) / Math.max(1, efforts().length - 1);
  const pick = (i: number) => {
    const e = efforts()[Math.max(0, Math.min(efforts().length - 1, i))];
    if (e) props.setChoice({ ...props.choice(), effort: e.value });
  };
  let from = 0;
  const drag = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e: any) => {
      const x = e?.nativeEvent?.locationX;
      from = typeof x === "number" ? Math.round((x - KNOB / 2) / step()) : idx();
      pick(from);
    },
    onPanResponderMove: (_e, g) => pick(Math.round(from + g.dx / step())),
  });
  // where the card goes: centered under the trigger, flipped above
  // when it would run off the window
  const pos = (h: number) => {
    const a = open()!.at, win = windowSize();
    const left = Math.max(8, Math.min(win.width - W - 8, a.x + a.w / 2 - W / 2));
    const below = a.y + a.h + 6;
    return { left, top: below + h > win.height - 8 ? Math.max(8, a.y - h - 6) : below };
  };
  const tip = (pos: { left?: number; right?: number; top: number }, text: string, sub?: string) => (
    <View
      style={{
        position: "absolute",
        ...pos,
        paddingVertical: 5,
        paddingHorizontal: 8,
        borderRadius: 8,
        backgroundColor: tc("#262626"),
        borderWidth: 0.5,
        borderColor: tc("#f5f5f51a"),
      }}
    >
      <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 12, lineHeight: 16 }}>{text}</Text>
      <If when={!!sub}>
        <Text numberOfLines={1} style={{ color: tc("#f5f5f5a8"), fontSize: 12, lineHeight: 16 }}>{sub}</Text>
      </If>
    </View>
  );
  // a getter, not a const — tc() must re-read themePref inside the tracked
  // style expression or the card freezes at mount (still "dark" before
  // /state loads the saved theme)
  const card = () =>
    ({
      position: "absolute",
      width: W,
      borderRadius: 12,
      backgroundColor: tc("#1f1f1f"),
      borderWidth: 0.5,
      borderColor: tc("#f5f5f51a"),
      boxShadow: "0 10px 24px -6px rgba(0,0,0,0.45)",
    }) as const;
  return (
    <If when={!!open()}>
      <View onPress={() => open.set(null)} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      {/* ————— effort card ————— */}
      <If when={open()?.mode === "effort"}>
        <View onPress={() => {}} style={{ ...card(), ...pos(efforts().length ? 92 : 56), padding: 8, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", height: 36 }}>
            {/* fast mode: only on models with a "--fast" twin; elsewhere an empty seat */}
            <If when={!!modelOf(props.choice().model)?.fast}>
              <View
                onPress={() => props.setChoice({ ...props.choice(), fast: !props.choice().fast })}
                onHoverIn={() => hover.set("fast")}
                onHoverOut={() => hover.set("")}
                activeOpacity={0.7}
                accessibilityLabel={props.choice().fast ? "Fast mode (on)" : "Fast mode (off)"}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: props.choice().fast ? "#f5b4002e" : hover() === "fast" ? tc("#f5f5f514") : "transparent",
                }}
              >
                <Text style={{ color: props.choice().fast ? "#f5b400" : tc("#f5f5f58a"), fontSize: 14 }}>ϟ</Text>
              </View>
            </If>
            <If when={!modelOf(props.choice().model)?.fast}>
              <View style={{ width: 28, height: 28 }} />
            </If>
            <View style={{ flex: 1, alignItems: "center" }}>
              <View
                onPress={() => open.set({ ...open()!, mode: "list" })}
                onHoverIn={() => hover.set("model")}
                onHoverOut={() => hover.set("")}
                activeOpacity={0.8}
                accessibilityLabel="Change model"
                style={{
                  alignItems: "center",
                  paddingHorizontal: 10,
                  paddingVertical: 2,
                  borderRadius: 8,
                  backgroundColor: hover() === "model" ? tc("#f5f5f514") : "transparent",
                }}
              >
                <Text style={{ color: isTop(props.choice()) ? TOP_TINT : tc("#f5f5f5"), fontSize: 13, lineHeight: 18, fontWeight: "500" }}>
                  {effortLabel(props.choice()) || "Default effort"}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                  <Text numberOfLines={1} style={{ color: tc("#f5f5f5a8"), fontSize: 12, lineHeight: 16 }}>
                    {prettyModel(props.choice().model)}
                  </Text>
                  <Text style={{ color: tc("#f5f5f5a8"), fontSize: 11 }}>›</Text>
                </View>
              </View>
            </View>
            <View
              onPress={() => {
                const m = modelOf(props.choice().model);
                props.setChoice({ model: props.choice().model, effort: m?.defaultEffort ?? "", fast: false });
              }}
              onHoverIn={() => hover.set("reset")}
              onHoverOut={() => hover.set("")}
              activeOpacity={0.7}
              accessibilityLabel="Reset to default"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: hover() === "reset" ? tc("#f5f5f514") : "transparent",
              }}
            >
              <Text style={{ color: tc("#f5f5f58a"), fontSize: 14 }}>↺</Text>
            </View>
          </View>
          {/* tooltips at card level, above their buttons (Codex) */}
          <If when={hover() === "fast" && !!modelOf(props.choice().model)?.fast}>
            {tip({ left: -4, top: -34 }, props.choice().fast ? "Fast mode" : "Normal mode")}
          </If>
          <If when={hover() === "reset"}>{tip({ right: -10, top: -34 }, "Reset to default")}</If>
          {/* stepped slider: a dot per effort, blue fill to the knob, violet at Ultra */}
          <If when={efforts().length > 0}>
            <View {...drag.panHandlers} style={{ width: TRACK, height: KNOB, alignSelf: "center", justifyContent: "center" }}>
              <View style={{ position: "absolute", left: 0, right: 0, height: KNOB, borderRadius: KNOB / 2, backgroundColor: tc("#f5f5f50f") }} />
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  width: idx() * step() + KNOB,
                  height: KNOB,
                  borderRadius: KNOB / 2,
                  overflow: "hidden",
                  backgroundColor: "#1e86fc",
                  backgroundImage: isTop(props.choice()) ? "linear-gradient(90deg, #4f6bff, #7c5cf0 55%, #a26bfa)" : undefined,
                }}
              >
                <If when={isTop(props.choice())}>
                  {/* a light band sweeping across, and drifting sparkles */}
                  <View
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: 46,
                      backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.28), rgba(255,255,255,0))",
                      transform: [{ translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [-50, TRACK] }) }],
                    }}
                  />
                  {SPARKS.map(([x, y, r], k) => (
                    <View
                      style={{
                        position: "absolute",
                        left: x * (TRACK - KNOB),
                        top: y * KNOB - r / 2,
                        width: r,
                        height: r,
                        borderRadius: r / 2,
                        backgroundColor: "#ffffff",
                        opacity: twinkle[k % twinkle.length],
                        transform: [{ translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0, 6] }) }],
                      }}
                    />
                  ))}
                </If>
              </View>
              <Each of={efforts()}>
                {(_e, i) => (
                  <View
                    style={{
                      position: "absolute",
                      left: i() * step() + KNOB / 2 - 2,
                      width: 4,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: i() <= idx() ? "#ffffffb3" : tc("#f5f5f54d"),
                    }}
                  />
                )}
              </Each>
              <View
                style={{
                  position: "absolute",
                  left: idx() * step(),
                  width: KNOB,
                  height: KNOB,
                  borderRadius: KNOB / 2,
                  backgroundColor: "#ffffff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
                }}
              />
            </View>
          </If>
        </View>
      </If>
      {/* ————— model list ————— */}
      <If when={open()?.mode === "list"}>
        <View onPress={() => {}} style={{ ...card(), ...pos(286), paddingVertical: 6 }}>
          <Text style={{ color: tc("#f5f5f58a"), fontSize: 12, lineHeight: 16, paddingHorizontal: 12, paddingVertical: 4 }}>Select model</Text>
          <Scroll style={{ maxHeight: 256 }} contentContainerStyle={{ paddingHorizontal: 4 }}>
            <View
              onPress={() => {
                props.setChoice({ model: "", effort: "", fast: false });
                open.set(null);
              }}
              activeOpacity={0.7}
              style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: !props.choice().model ? tc("#f5f5f50f") : "transparent" }}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ flex: 1, color: tc("#f5f5f5"), fontSize: 13, lineHeight: 18 }}>Default</Text>
                <If when={!props.choice().model}>
                  <Text style={{ color: tc("#f5f5f5"), fontSize: 12 }}>✓</Text>
                </If>
              </View>
              <Text style={{ color: tc("#f5f5f58a"), fontSize: 12, lineHeight: 16 }}>{`Recommended · ${defaultModel()}`}</Text>
            </View>
            <Each of={models()}>
              {(m) => (
                <View
                  onPress={() => {
                    props.setChoice({ model: m().id, effort: m().defaultEffort, fast: false });
                    open.set({ ...open()!, mode: "effort" });
                  }}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    height: 25,
                    paddingHorizontal: 8,
                    borderRadius: 8,
                    backgroundColor: props.choice().model === m().id ? tc("#f5f5f50f") : "transparent",
                  }}
                >
                  <Text numberOfLines={1} style={{ flex: 1, color: tc("#f5f5f5"), fontSize: 13, lineHeight: 18 }}>{prettyModel(m().id)}</Text>
                  <If when={props.choice().model === m().id}>
                    <Text style={{ color: tc("#f5f5f5"), fontSize: 12 }}>✓</Text>
                  </If>
                </View>
              )}
            </Each>
            <If when={!models().length}>
              <Text style={{ color: tc("#f5f5f58a"), fontSize: 12, padding: 8 }}>opencodex isn't reachable on :8080</Text>
            </If>
          </Scroll>
        </View>
      </If>
    </If>
  );
}
