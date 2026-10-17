import { signal, Text, View } from "nsh";

export default function R() {
  const streak = signal(4);
  const best = signal(9);
  const doneToday = signal(false);
  const history = signal([true, true, false, true, true, true, true]);

  const checkIn = () => {
    if (doneToday()) return;
    doneToday.set(true);
    const next = streak() + 1;
    streak.set(next);
    if (next > best()) best.set(next);
    history.update((h) => [...h.slice(1), true]);
  };

  const days = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <View class="flex-col gap-4 p-4 bg-white rounded-2xl border border-gray-200 w-full">
      <View class="flex-row items-center justify-between">
        <View class="flex-col">
          <Text class="text-xs font-semibold text-gray-500 uppercase">Habit</Text>
          <Text class="text-lg font-bold text-gray-900">Morning run</Text>
        </View>
        <View class="flex-row items-center gap-1 px-3 py-1 rounded-full bg-orange-100">
          <Text class="text-base">🔥</Text>
          <Text class="text-sm font-bold text-orange-600">{streak()} day streak</Text>
        </View>
      </View>

      <View class="flex-row justify-between">
        {history().map((done, i) => (
          <View class="flex-col items-center gap-1">
            <View
              class={done ? "w-8 h-8 rounded-full bg-orange-500 items-center justify-center" : "w-8 h-8 rounded-full bg-gray-200 items-center justify-center"}
            >
              <Text class={done ? "text-xs font-bold text-white" : "text-xs font-bold text-gray-500"}>
                {done ? "✓" : ""}
              </Text>
            </View>
            <Text class="text-xs text-gray-400">{days[i]}</Text>
          </View>
        ))}
      </View>

      <View class="flex-row justify-between items-center">
        <Text class="text-sm text-gray-500">Best: {best()} days</Text>
        <View
          onPress={checkIn}
          activeOpacity={0.7}
          class={doneToday() ? "px-5 py-3 rounded-xl bg-gray-300" : "px-5 py-3 rounded-xl bg-orange-500"}
        >
          <Text class={doneToday() ? "text-sm font-bold text-gray-600" : "text-sm font-bold text-white"}>
            {doneToday() ? "Checked in ✓" : "Check in"}
          </Text>
        </View>
      </View>
    </View>
  );
}