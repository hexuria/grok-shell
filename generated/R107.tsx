import { signal, Text, View, Input, effect, cleanup, split } from "nsh";

export default function R() {
  const S = "tipcalc";
  const bill = signal("");
  const tip = signal(18);
  const split = signal(2);
  let snap = "";

  const save = (b = bill(), t = tip(), s = split()) => {
    const body = JSON.stringify({ bill: b, tip: t, split: s });
    snap = body;
    fetch(`http://127.0.0.1:8787/state/${S}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {});
  };

  const apply = (st: any) => {
    if (typeof st.bill === "string") bill.set(st.bill);
    if (typeof st.tip === "number") tip.set(st.tip);
    if (typeof st.split === "number") split.set(st.split);
  };

  fetch(`http://127.0.0.1:8787/state/${S}`)
    .then((r) => r.json())
    .then((d) => {
      if (d && d.state) {
        snap = JSON.stringify(d.state);
        apply(d.state);
      }
    })
    .catch(() => {});

  effect(() => {
    const t = setInterval(async () => {
      try {
        const d = await fetch(`http://127.0.0.1:8787/state/${S}`).then((r) => r.json());
        const s = JSON.stringify(d?.state || {});
        if (s !== "{}" && s !== snap) {
          snap = s;
          apply(d.state);
        }
      } catch {}
    }, 2000);
    cleanup(() => clearInterval(t));
  });

  const amount = () => parseFloat(bill()) || 0;
  const tipAmt = () => (amount() * tip()) / 100;
  const total = () => amount() + tipAmt();
  const perPerson = () => total() / split();
  const money = (n: number) => "$" + n.toFixed(2);

  const setTip = (v: number) => {
    const c = Math.max(0, Math.min(100, v));
    tip.set(c);
    save(bill(), c, split());
  };
  const setSplit = (v: number) => {
    const c = Math.max(1, Math.min(20, v));
    split.set(c);
    save(bill(), tip(), c);
  };

  return (
    <View class="flex flex-col gap-4 p-4 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 min-h-64">
      <View class="flex flex-col gap-1">
        <Text class="text-xs font-semibold text-gray-500 dark:text-gray-400">BILL AMOUNT</Text>
        <Input
          value={bill()}
          placeholder="0.00"
          onChangeText={(v: string) => {
            bill.set(v);
            save(v, tip(), split());
          }}
          class="px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-600 text-lg text-gray-900 dark:text-gray-100"
        />
      </View>

      <View class="flex flex-col gap-2">
        <View class="flex flex-row justify-between items-center">
          <Text class="text-xs font-semibold text-gray-500 dark:text-gray-400">TIP</Text>
          <Text class="text-sm font-semibold text-gray-900 dark:text-gray-100">{tip() + "%"}</Text>
        </View>
        <View class="flex flex-row items-center gap-2">
          <View onPress={() => setTip(tip() - 1)} activeOpacity={0.7} class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-zinc-800 items-center justify-center">
            <Text class="text-lg text-gray-900 dark:text-gray-100">−</Text>
          </View>
          <View class="flex flex-row flex-1 gap-1">
            <View onPress={() => setTip(10)} activeOpacity={0.7} class="flex-1 py-2 rounded-md bg-gray-100 dark:bg-zinc-800 items-center"><Text class="text-xs text-gray-900 dark:text-gray-100">10</Text></View>
            <View onPress={() => setTip(15)} activeOpacity={0.7} class="flex-1 py-2 rounded-md bg-gray-100 dark:bg-zinc-800 items-center"><Text class="text-xs text-gray-900 dark:text-gray-100">15</Text></View>
            <View onPress={() => setTip(18)} activeOpacity={0.7} class="flex-1 py-2 rounded-md bg-gray-100 dark:bg-zinc-800 items-center"><Text class="text-xs text-gray-900 dark:text-gray-100">18</Text></View>
            <View onPress={() => setTip(20)} activeOpacity={0.7} class="flex-1 py-2 rounded-md bg-gray-100 dark:bg-zinc-800 items-center"><Text class="text-xs text-gray-900 dark:text-gray-100">20</Text></View>
            <View onPress={() => setTip(25)} activeOpacity={0.7} class="flex-1 py-2 rounded-md bg-gray-100 dark:bg-zinc-800 items-center"><Text class="text-xs text-gray-900 dark:text-gray-100">25</Text></View>
          </View>
          <View onPress={() => setTip(tip() + 1)} activeOpacity={0.7} class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-zinc-800 items-center justify-center">
            <Text class="text-lg text-gray-900 dark:text-gray-100">+</Text>
          </View>
        </View>
      </View>

      <View class="flex flex-row justify-between items-center">
        <Text class="text-xs font-semibold text-gray-500 dark:text-gray-400">SPLIT</Text>
        <View class="flex flex-row items-center gap-3">
          <View onPress={() => setSplit(split() - 1)} activeOpacity={0.7} class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-zinc-800 items-center justify-center">
            <Text class="text-lg text-gray-900 dark:text-gray-100">−</Text>
          </View>
          <Text class="text-lg font-semibold w-8 text-center text-gray-900 dark:text-gray-100">{split() + ""}</Text>
          <View onPress={() => setSplit(split() + 1)} activeOpacity={0.7} class="w-10 h-10 rounded-lg bg-gray-100 dark:bg-zinc-800 items-center justify-center">
            <Text class="text-lg text-gray-900 dark:text-gray-100">+</Text>
          </View>
        </View>
      </View>

      <View class="flex flex-col gap-2 p-3 rounded-lg bg-gray-50 dark:bg-zinc-800">
        <View class="flex flex-row justify-between">
          <Text class="text-sm text-gray-500 dark:text-gray-400">Tip</Text>
          <Text class="text-sm text-gray-900 dark:text-gray-100">{money(tipAmt())}</Text>
        </View>
        <View class="flex flex-row justify-between">
          <Text class="text-sm text-gray-500 dark:text-gray-400">Total</Text>
          <Text class="text-sm text-gray-900 dark:text-gray-100">{money(total())}</Text>
        </View>
        <View class="flex flex-row justify-between items-center pt-2 border-t border-gray-200 dark:border-zinc-700">
          <Text class="text-sm font-semibold text-gray-900 dark:text-gray-100">Per person</Text>
          <Text class="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{money(perPerson())}</Text>
        </View>
      </View>
    </View>
  );
}