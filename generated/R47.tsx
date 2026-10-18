import { signal, Text, View } from "nsh";

export default function R() {
  const n = signal(0);
  return (
    <View class="items-center gap-3 py-2">
      <Text class="text-5xl font-bold text-zinc-900">{n()}</Text>
      <View class="flex-row gap-3">
        <View onPress={() => n.update((v) => v - 1)} activeOpacity={0.6} class="rounded-lg bg-zinc-200 px-5 py-2"><Text class="text-lg">−</Text></View>
        <View onPress={() => n.update((v) => v + 1)} activeOpacity={0.6} class="rounded-lg bg-blue-600 px-5 py-2"><Text class="text-lg font-semibold text-white">+</Text></View>
      </View>
    </View>
  );
}
