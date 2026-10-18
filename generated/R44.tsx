import { signal, effect, cleanup, Text, View } from "nsh";

const S = "R44";

export default function R() {
  const count = signal(0);
  let snap = "";

  const apply = (state: any) => {
    if (state && typeof state.count === "number") count.set(state.count);
  };

  const save = () => {
    const body = JSON.stringify({ count: count() });
    snap = body;
    fetch(`http://127.0.0.1:8787/state/${S}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {});
  };

  fetch(`http://127.0.0.1:8787/state/${S}`)
    .then((r) => r.json())
    .then((d) => {
      if (d && d.state) apply(d.state);
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

  const greet = () => {
    count.update((n) => n + 1);
    save();
  };

  return (
    <View class="flex flex-col gap-4 p-5 rounded-xl bg-white border border-gray-200">
      <Text class="text-xl font-bold text-gray-900">Hello there 👋</Text>
      <Text class="text-sm text-gray-500">
        {count() === 0
          ? "You haven't said hi yet."
          : `You've said hi ${count()} ${count() === 1 ? "time" : "times"}.`}
      </Text>
      <View
        class="flex flex-row items-center justify-center py-3 rounded-lg bg-blue-500"
        onPress={greet}
        activeOpacity={0.7}
      >
        <Text class="text-base font-semibold text-white">Say hi</Text>
      </View>
    </View>
  );
}