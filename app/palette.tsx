// ⌘K command palette, Grok Bot's: a centered 486pt card, a search row, and
// 44pt rows (icon, title, subtitle; a ✓ on the current theme). Arrow keys
// move, Enter runs, Escape closes, ⌘1–⌘9 run a search result directly.
import { cleanup, effect, Input, Scroll, signal, Text, View } from "nsh";
import { keymap } from "nsh/keymap";
import { windowSize } from "nsh/device";
import { tc } from "./theme";

export type PaletteItem = {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  checked?: boolean;
  run: () => void;
};

export const paletteOpen = signal(false);

export function Palette(props: { items: () => PaletteItem[] }) {
  const query = signal("");
  const sel = signal(0);
  const results = () => {
    const q = query().trim().toLowerCase();
    const all = props.items();
    return q ? all.filter((i) => (i.title + " " + (i.subtitle || "")).toLowerCase().includes(q)) : all;
  };
  const close = () => {
    paletteOpen.set(false);
    query.set("");
    sel.set(0);
  };
  const runAt = (i: number) => {
    const it = results()[i];
    if (!it) return;
    close();
    it.run();
  };
  effect(() => {
    if (!paletteOpen()) return;
    const always = { when: "always" as const };
    const offs = [
      keymap.bind("escape", close, always),
      keymap.bind("down", () => sel.set(Math.min(results().length - 1, sel() + 1)), { ...always, repeat: true }),
      keymap.bind("up", () => sel.set(Math.max(0, sel() - 1)), { ...always, repeat: true }),
      keymap.bind("enter", () => runAt(sel()), always),
      ...Array.from({ length: 9 }, (_, k) => keymap.bind(`mod+${k + 1}`, () => query() && runAt(k), always)),
    ];
    cleanup(() => offs.forEach((f) => f()));
  });
  const ROW = 44;
  return (
    <If when={paletteOpen()}>
      <View onPress={close} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
      <View
        onPress={() => {}}
        style={{
          position: "absolute",
          width: 486,
          left: Math.max(8, (windowSize().width - 486) / 2),
          top: Math.max(40, (windowSize().height - 395) / 2),
          maxHeight: 395,
          borderRadius: 14,
          backgroundColor: tc("#1f1f1f"),
          borderWidth: 0.5,
          borderColor: tc("#f5f5f51a"),
          boxShadow: "0 18px 48px -12px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.2)",
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 44, paddingHorizontal: 14, borderBottomWidth: 0.5, borderBottomColor: tc("#f5f5f51a") }}>
          <Text style={{ color: tc("#f5f5f58a"), fontSize: 13 }}>⌕</Text>
          <Input
            value={query()}
            onChangeText={(t) => {
              query.set(t);
              sel.set(0);
            }}
            placeholder="Search"
            placeholderTextColor={tc("#f5f5f58a")}
            autoFocus
            style={{ flex: 1, fontSize: 14, color: tc("#f5f5f5") }}
          />
        </View>
        <Scroll style={{ maxHeight: 395 - 44 }} contentContainerStyle={{ padding: 6 }}>
          <Each of={results()}>
            {(it, i) => (
              <View
                onPress={() => runAt(i())}
                onHoverIn={() => sel.set(i())}
                activeOpacity={0.8}
                accessibilityLabel={it().title}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  height: ROW,
                  paddingHorizontal: 8,
                  borderRadius: 8,
                  backgroundColor: sel() === i() ? tc("#f5f5f50f") : "transparent",
                }}
              >
                <View style={{ width: 20, height: 20, borderRadius: 5, backgroundColor: tc("#f5f5f50a"), alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: tc("#f5f5f5a8"), fontSize: 11 }}>{it().icon}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 13, lineHeight: 18 }}>{it().title}</Text>
                  <If when={!!it().subtitle}>
                    <Text numberOfLines={1} style={{ color: tc("#f5f5f58a"), fontSize: 12, lineHeight: 16 }}>{it().subtitle}</Text>
                  </If>
                </View>
                <If when={!!it().checked}>
                  <Text style={{ color: tc("#f5f5f5a8"), fontSize: 12 }}>✓</Text>
                </If>
                <If when={!!query().trim() && i() < 9}>
                  <Text style={{ color: tc("#f5f5f58a"), fontSize: 11 }}>{`⌘${i() + 1}`}</Text>
                </If>
              </View>
            )}
          </Each>
          <If when={results().length === 0}>
            <Text style={{ color: tc("#f5f5f58a"), fontSize: 13, padding: 12 }}>No results</Text>
          </If>
        </Scroll>
      </View>
    </If>
  );
}
