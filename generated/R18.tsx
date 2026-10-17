import { signal, Text, View } from "nsh";

const tracks = [
  { title: "Midnight Drive", artist: "Neon Pines", color: "bg-indigo-500" },
  { title: "Paper Lanterns", artist: "Mira Vale", color: "bg-rose-500" },
  { title: "Low Tide Hymn", artist: "The Harbor Choir", color: "bg-teal-500" },
  { title: "Golden Static", artist: "Kite & Comet", color: "bg-amber-500" },
];

export default function R() {
  const idx = signal(0);
  const playing = signal(false);

  const next = () => idx.update((i) => (i + 1) % tracks.length);
  const prev = () => idx.update((i) => (i - 1 + tracks.length) % tracks.length);
  const toggle = () => playing.update((p) => !p);

  return (
    <View class="flex flex-col gap-5 p-5 rounded-2xl bg-slate-900">
      <View class="flex flex-row items-center gap-4">
        <View class={`w-16 h-16 rounded-xl items-center justify-center ${tracks[idx()].color}`}>
          <Text class="text-white text-2xl font-bold">♪</Text>
        </View>
        <View class="flex flex-col flex-1 gap-1">
          <Text class="text-white text-lg font-bold">{tracks[idx()].title}</Text>
          <Text class="text-slate-400 text-sm">{tracks[idx()].artist}</Text>
        </View>
      </View>

      <View class="flex flex-row items-end justify-center gap-1 h-12">
        <Each of={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}>
          {(b, i) => (
            <View
              style={{
                width: 6,
                borderRadius: 3,
                height: playing() ? 8 + ((i() * 7 + idx() * 3) % 30) : 4,
              }}
              class="bg-indigo-400"
            />
          )}
        </Each>
      </View>

      <View class="h-1 rounded-full bg-slate-700">
        <View
          style={{ height: 4, borderRadius: 2, width: ((idx() + 1) / tracks.length) * 300 }}
          class={tracks[idx()].color}
        />
      </View>

      <View class="flex flex-row items-center justify-between px-2">
        <View onPress={prev} activeOpacity={0.7} class="w-14 h-14 rounded-full bg-slate-800 items-center justify-center">
          <Text class="text-white text-xl">⏮</Text>
        </View>
        <View onPress={toggle} activeOpacity={0.7} class="w-20 h-20 rounded-full bg-indigo-500 items-center justify-center">
          <Text class="text-white text-3xl">{playing() ? "⏸" : "▶"}</Text>
        </View>
        <View onPress={next} activeOpacity={0.7} class="w-14 h-14 rounded-full bg-slate-800 items-center justify-center">
          <Text class="text-white text-xl">⏭</Text>
        </View>
      </View>

      <Text class="text-slate-500 text-xs text-center">
        {playing() ? "Now playing" : "Paused"} · Track {idx() + 1} of {tracks.length}
      </Text>
    </View>
  );
}