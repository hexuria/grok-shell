import { signal, effect, cleanup, Text, View, Scroll } from "nsh";

type Hist = { label: string; total: number; dice: number[] };

const S = "R119";
const SIDES: number[] = [4, 6, 8, 10, 12, 20];

export default function R() {
  const sides = signal<number>(6);
  const count = signal<number>(2);
  const dice = signal<number[]>([]);
  const total = signal<number>(0);
  const rolls = signal<number>(0);
  const history = signal<Hist[]>([]);
  const rolling = signal<boolean>(false);
  let snap = "";

  const apply = (d: any) => {
    if (!d) return;
    if (typeof d.rolls === "number") rolls.set(d.rolls);
    if (Array.isArray(d.history)) history.set(d.history as Hist[]);
  };

  const save = () => {
    const state = { rolls: rolls(), history: history() };
    snap = JSON.stringify(state);
    fetch(`http://127.0.0.1:8787/state/${S}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {});
  };

  // restore once
  fetch(`http://127.0.0.1:8787/state/${S}`)
    .then((r) => r.json())
    .then((d: any) => {
      if (d && d.state) {
        snap = JSON.stringify(d.state);
        apply(d.state);
      }
    })
    .catch(() => {});

  // sync other surfaces
  effect(() => {
    const t = setInterval(async () => {
      try {
        const d: any = await fetch(`http://127.0.0.1:8787/state/${S}`).then((r) => r.json());
        const s = JSON.stringify(d?.state || {});
        if (s !== "{}" && s !== snap) {
          snap = s;
          apply(d.state);
        }
      } catch {}
    }, 2000);
    cleanup(() => clearInterval(t));
  });

  const randomDice = (n: number, s: number): number[] =>
    Array.from({ length: n }, () => 1 + Math.floor(Math.random() * s));

  const finish = (n: number, s: number) => {
    const vals = randomDice(n, s);
    const sum = vals.reduce((a, b) => a + b, 0);
    dice.set(vals);
    total.set(sum);
    rolls.update((r) => r + 1);
    history.update((h) => [{ label: `${n}d${s}`, total: sum, dice: vals }, ...h].slice(0, 10));
    rolling.set(false);
    save();
  };

  const roll = () => {
    if (rolling()) return;
    const n = count();
    const s = sides();
    rolling.set(true);
    let ticks = 0;
    const t = setInterval(() => {
      ticks++;
      dice.set(randomDice(n, s));
      if (ticks >= 8) {
        clearInterval(t);
        finish(n, s);
      }
    }, 60);
  };

  const clearAll = () => {
    rolls.set(0);
    history.set([]);
    dice.set([]);
    total.set(0);
    save();
  };

  return (
    <View class="flex-col gap-3 p-4 bg-white dark:bg-zinc-900 rounded-xl min-h-96">
      <View class="flex-row justify-between items-center">
        <Text class="text-lg font-bold text-gray-900 dark:text-gray-100">Dice Roller</Text>
        <Text class="text-xs text-gray-500 dark:text-gray-400">{`${rolls()} rolls`}</Text>
      </View>

      <View class="flex-row gap-2">
        <Each of={SIDES}>
          {(s: any) => (
            <View
              onPress={() => sides.set(s())}
              activeOpacity={0.7}
              class={
                sides() === s()
                  ? "flex-1 py-2 rounded-lg items-center bg-indigo-600"
                  : "flex-1 py-2 rounded-lg items-center bg-gray-100 dark:bg-zinc-800"
              }
            >
              <Text class={sides() === s() ? "text-white text-sm font-bold" : "text-gray-700 dark:text-gray-200 text-sm"}>
                {`d${s()}`}
              </Text>
            </View>
          )}
        </Each>
      </View>

      <View class="flex-row items-center justify-between">
        <Text class="text-sm text-gray-600 dark:text-gray-300">Dice count</Text>
        <View class="flex-row items-center gap-3">
          <View
            onPress={() => count.set(Math.max(1, count() - 1))}
            activeOpacity={0.7}
            class="w-8 h-8 rounded-full items-center justify-center bg-gray-100 dark:bg-zinc-800"
          >
            <Text class="text-lg text-gray-900 dark:text-gray-100">−</Text>
          </View>
          <Text class="w-6 text-center font-bold text-gray-900 dark:text-gray-100">{`${count()}`}</Text>
          <View
            onPress={() => count.set(Math.min(6, count() + 1))}
            activeOpacity={0.7}
            class="w-8 h-8 rounded-full items-center justify-center bg-gray-100 dark:bg-zinc-800"
          >
            <Text class="text-lg text-gray-900 dark:text-gray-100">+</Text>
          </View>
        </View>
      </View>

      <View class="flex-row flex-wrap gap-2 justify-center min-h-16 items-center">
        <If when={dice().length === 0}>
          <Text class="text-sm text-gray-400">Tap roll to start</Text>
        </If>
        <Each of={dice()}>
          {(v: any) => (
            <View class="w-14 h-14 rounded-xl items-center justify-center bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800">
              <Text class="text-2xl font-bold text-indigo-700 dark:text-indigo-300">{`${v()}`}</Text>
            </View>
          )}
        </Each>
      </View>

      <View class="items-center">
        <Text class="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {dice().length ? `${total()}` : "–"}
        </Text>
        <Text class="text-xs text-gray-500 dark:text-gray-400">Total</Text>
      </View>

      <View onPress={roll} activeOpacity={0.7} class="bg-indigo-600 rounded-xl py-3 items-center">
        <Text class="text-white font-bold">{rolling() ? "Rolling…" : `Roll ${count()}d${sides()}`}</Text>
      </View>

      <View class="flex-row justify-between items-center">
        <Text class="text-sm font-bold text-gray-700 dark:text-gray-200">History</Text>
        <View onPress={clearAll} activeOpacity={0.7}>
          <Text class="text-xs text-red-500">Clear</Text>
        </View>
      </View>

      <If when={history().length === 0}>
        <Text class="text-sm text-gray-400">No rolls yet</Text>
      </If>

      <Scroll class="max-h-48">
        <Each of={history()}>
          {(h: any) => (
            <View class="flex-row justify-between py-2 border-b border-gray-100 dark:border-zinc-800">
              <Text class="text-sm text-gray-700 dark:text-gray-200">{h().label}</Text>
              <Text class="text-sm text-gray-500 dark:text-gray-400">{`${h().dice.join(", ")} = ${h().total}`}</Text>
            </View>
          )}
        </Each>
      </Scroll>
    </View>
  );
}