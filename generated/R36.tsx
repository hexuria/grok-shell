import { signal, effect, cleanup, Text, View } from "nsh";

const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function R() {
  const now = signal(new Date());
  const use24 = signal(true);

  effect(() => {
    const t = setInterval(() => now.set(new Date()), 1000);
    cleanup(() => clearInterval(t));
  });

  const hours = () => {
    const h = now().getHours();
    if (use24()) return pad(h);
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return pad(h12);
  };
  const minutes = () => pad(now().getMinutes());
  const seconds = () => pad(now().getSeconds());
  const period = () => (now().getHours() < 12 ? "AM" : "PM");
  const dateLine = () => {
    const d = now();
    return DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
  };

  return (
    <View class="flex flex-col p-5 gap-4 rounded-2xl bg-slate-900 w-full">
      <View class="flex flex-row justify-between items-center">
        <Text class="text-slate-400 text-sm font-semibold">{dateLine()}</Text>
        <View
          onPress={() => use24.update((v) => !v)}
          activeOpacity={0.7}
          class="px-3 py-1 rounded-full bg-slate-800 border border-slate-700"
        >
          <Text class="text-cyan-300 text-xs font-bold">{use24() ? "24H" : "12H"}</Text>
        </View>
      </View>

      <View class="flex flex-row justify-center items-end gap-1">
        <Text class="text-white text-6xl font-bold">{hours()}</Text>
        <Text class="text-slate-500 text-5xl font-bold">:</Text>
        <Text class="text-white text-6xl font-bold">{minutes()}</Text>
        <View class="flex flex-col items-start ml-2 mb-1">
          <Text class="text-cyan-400 text-2xl font-bold">{seconds()}</Text>
          {!use24() ? <Text class="text-slate-400 text-xs font-bold">{period()}</Text> : null}
        </View>
      </View>

      <View class="flex flex-col gap-2">
        <View class="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
          <View
            class="h-2 rounded-full bg-cyan-400"
            style={{ width: (300 * now().getSeconds()) / 60 }}
          />
        </View>
        <View class="flex flex-row justify-between">
          <Text class="text-slate-500 text-xs">Second {seconds()} of 60</Text>
          <Text class="text-slate-500 text-xs">{use24() ? "Military time" : "Standard time"}</Text>
        </View>
      </View>
    </View>
  );
}