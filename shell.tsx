import { signal, Text, View } from "nsh";
import { Markdown } from "./md";

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
  const work = signal("");
  const extra = signal("");

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

  const publish = () => {
    if (published()) return;
    post("/publish", { name: props.name }).then((d) => {
      if (d?.ok) {
        published.set(true);
        extra.set(`published — see Work tab`);
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
        backgroundColor: active ? "#2f2f2f" : "transparent",
      }}
    >
      <Text style={{ color: active ? "#ececec" : "#8e8e93", fontSize: 13 }}>
        {icon}
      </Text>
    </View>
  );

  return (
    <View
      class="self-stretch rounded-2xl p-3"
      style={{
        backgroundColor: "#181818",
        borderWidth: 1,
        borderColor: "#2a2a2a",
      }}
    >
      <View class="flex-row items-center justify-between">
        <Text
          class="text-[11px] font-medium uppercase tracking-wider"
          style={{ color: "#737373" }}
        >
          {props.label}
        </Text>
        {btn("⤴", share, false, "reveal in Finder")}
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
            backgroundColor: "#0d0d0f",
            borderWidth: 1,
            borderColor: "#262626",
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
              backgroundColor: "#1c1c1e",
            }}
          >
            <Text
              style={{ color: "#8e8e93", fontSize: 11, fontFamily: "Menlo" }}
            >
              {`${props.name}.tsx`}
            </Text>
            <View onPress={copySource} activeOpacity={0.7}>
              <Text style={{ color: "#8e8e93", fontSize: 11 }}>
                {copied() ? "✓ copied" : "⧉ copy"}
              </Text>
            </View>
          </View>
          <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text
              style={{
                fontFamily: "Menlo",
                fontSize: 11.5,
                color: "#a3a3a3",
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
        {btn(published() ? "✓" : "⬆", publish, published(), "publish to Work tab")}
        <If when={!!work()}>
          <Text style={{ color: "#8e8e93", fontSize: 11 }}>
            {work()}
          </Text>
        </If>
        <If when={!!extra()}>
          <Text style={{ color: "#10a37f", fontSize: 11 }}>{extra()}</Text>
        </If>
      </View>
    </View>
  );
}
