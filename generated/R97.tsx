import { effect, signal, Text, View } from "nsh";
import { keymap } from "nsh/keymap";

const S = "R97";
const n = signal(0);
const last = signal("none");
const save = () =>
  fetch(`http://127.0.0.1:8787/state/${S}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ n: n(), last: last() }),
  });

export default function R() {
  effect(() => {
    fetch(`http://127.0.0.1:8787/state/${S}`)
      .then((r) => r.json())
      .then((d) => { if (d?.state) { n.set(d.state.n ?? 0); last.set(d.state.last ?? "none"); } })
      .catch(() => {});
    keymap.bind({
      left: () => { last.set("left"); n.set(n() - 1); save(); },
      right: () => { last.set("right"); n.set(n() + 1); save(); },
      space: () => { last.set("space"); n.set(0); save(); },
    }, { repeat: true });
  });
  return (
    <View class="gap-2 p-4">
      <Text class="text-xl font-bold">{"keytest n=" + n()}</Text>
      <Text class="text-sm">{"last key: " + last()}</Text>
    </View>
  );
}
