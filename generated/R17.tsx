import { signal, Text, View } from "nsh";

const days = [
  { d: "Mon", icon: "☀️", hi: 31, lo: 24, rain: 5 },
  { d: "Tue", icon: "☀️", hi: 32, lo: 25, rain: 10 },
  { d: "Wed", icon: "⛅", hi: 30, lo: 24, rain: 30 },
  { d: "Thu", icon: "🌦️", hi: 29, lo: 23, rain: 60 },
  { d: "Fri", icon: "☀️", hi: 31, lo: 24, rain: 8 },
];

export default function R() {
  const sel = signal(0);

  return (
    <View class="w-full bg-sky-500 rounded-2xl p-5 gap-4">
      <View class="flex-row justify-between items-start">
        <View>
          <Text class="text-white text-lg font-semibold">Manila</Text>
          <Text class="text-sky-100 text-sm">Philippines</Text>
        </View>
        <View class="bg-white/20 rounded-full px-3 py-1">
          <Text class="text-white text-xs font-medium">Sunny</Text>
        </View>
      </View>

      <View class="flex-row items-center justify-between">
        <Text class="text-white text-6xl font-bold">
          {days[sel()].hi}°
        </Text>
        <Text class="text-6xl">{days[sel()].icon}</Text>
      </View>

      <View class="flex-row justify-between">
        <Text class="text-sky-100 text-sm">
          {days[sel()].d} · High {days[sel()].hi}° / Low {days[sel()].lo}°
        </Text>
        <Text class="text-sky-100 text-sm">
          Rain {days[sel()].rain}%
        </Text>
      </View>

      <View class="h-px bg-white/30" />

      <View class="flex-row justify-between">
        <Each of={days}>
          {(day, i) => (
            <View
              onPress={() => sel.set(i())}
              activeOpacity={0.7}
              class={
                sel() === i()
                  ? "items-center gap-1 rounded-xl bg-white/30 px-2 py-2"
                  : "items-center gap-1 rounded-xl px-2 py-2"
              }
            >
              <Text class="text-white text-xs font-medium">{day().d}</Text>
              <Text class="text-xl">{day().icon}</Text>
              <Text class="text-white text-sm font-semibold">{day().hi}°</Text>
              <Text class="text-sky-100 text-xs">{day().lo}°</Text>
            </View>
          )}
        </Each>
      </View>

      <If when={sel() === 3}>
        <View class="bg-white/15 rounded-xl p-3">
          <Text class="text-white text-xs">
            Scattered showers expected in the afternoon. Bring an umbrella.
          </Text>
        </View>
      </If>
    </View>
  );
}