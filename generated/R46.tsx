import { signal, effect, cleanup, Text, View } from "nsh";

const S = "R46";
const SIDES = [4, 6, 8, 10, 20];

export default function R() {
  const sides = signal<number>(6);
  const count = signal<number>(2);
  const results = signal<number[]>([]);
  const total = signal<number>(0);
  const rolls = signal<number>(0);
  let snap = "";

  const apply = (d: any) => {
    if (typeof d.sides === "number") sides.set(d.sides);
    if (typeof d.count === "number") count.set(d.count);
    if (Array.isArray(d.results)) results.set(d.results as number[]);
    if (typeof d.total === "number") total.set(d.total);
    if (typeof d.rolls === "number") rolls.set(d.rolls);
  };

  const save = () => {
    snap = JSON.stringify({
      sides: sides(), count: count(), results: results(), total: total(), rolls: rolls(),
    });
    fetch(`http://127.0.0.1:8787/state/${S}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: snap,
    }).catch(() => {});
  };

  const roll = () => {
    const r: number[] = Array.from({ length: count() }, () => 1 + Math.floor(Math.random() * sides()));
    results.set(r);
    total.set(r.reduce((a: number, b: number) => a + b, 0));
    rolls.update((n: number) => n + 1);
    save();
  };

  const setCount = (n: number) => {
    count.set(Math.min(10, Math.max(1, n)));
    save();
  };

  const pickSides = (s: number) => {
    sides.set(s);
    save();
  };

  effect(() => {
    fetch(`http://127.0.0.1:8787/state/${S}`)
      .then((r) => r.json())
      .then((d: any) => { if (d && d.state) { apply(d.state); snap = JSON.stringify(d.state); } })
      .catch(() => {});
    const t = setInterval(async () => {
      try {
        const d: any = await fetch(`http://127.0.0.1:8787/state/${S}`).then((r) => r.json());
        const s = JSON.stringify(d?.state || {});
        if (s !== "{}" && s !== snap) { snap = s; apply(d.state); }
      } catch {}
    }, 2000);
    cleanup(() => clearInterval(t));
  });

  return (
    <View class="flex-col gap-3 p-4 bg-zinc-900 rounded-xl">
      <View class="flex-row gap-2 justify-between items-center">
        <Text class="text-white font-bold text-lg">Dice Roller</Text>
        <Text class="text-zinc-400 text-xs">{rolls()} rolls</Text>
      </View>

      <View class="flex-row gap-2">
        <Each of={SIDES}>
          {(s: any) => (
            <View
              onPress={() => pickSides(s())}
              activeOpacity={0.7}
              class="flex-1 items-center py-2 rounded-lg"
              style={{ backgroundColor: sides() === s() ? "#4f46e5" : "#27272a" }}
            >
              <Text class="text-white font-semibold">{"d" + s()}</Text>
            </View>
          )}
        </Each>
      </View>

      <View class="flex-row items-center justify-between">
        <Text class="text-zinc-300">Dice</Text>
        <View class="flex-row items-center gap-3">
          <View onPress={() => setCount(count() - 1)} activeOpacity={0.7}
            class="w-8 h-8 items-center justify-center rounded-full bg-zinc-700">
            <Text class="text-white font-bold">−</Text>
          </View>
          <Text class="text-white font-bold text-lg">{count()}</Text>
          <View onPress={() => setCount(count() + 1)} activeOpacity={0.7}
            class="w-8 h-8 items-center justify-center rounded-full bg-zinc-700">
            <Text class="text-white font-bold">+</Text>
          </View>
        </View>
      </View>

      <View onPress={roll} activeOpacity={0.7} class="items-center py-3 rounded-lg bg-indigo-600">
        <Text class="text-white font-bold">{"Roll " + count() + "d" + sides()}</Text>
      </View>

      <View class="flex-col items-center gap-2 p-3 rounded-lg bg-zinc-800">
        <View class="flex-row flex-wrap gap-2 justify-center">
          <Each of={results()}>
            {(r: any) => (
              <View class="w-10 h-10 items-center justify-center rounded-lg bg-white">
                <Text class="text-zinc-900 font-bold">{r()}</Text>
              </View>
            )}
          </Each>
        </View>
        <Text class="text-indigo-300 font-bold text-2xl">
          {results().length ? "Total " + total() : "Tap roll to start"}
        </Text>
      </View>
    </View>
  );
}