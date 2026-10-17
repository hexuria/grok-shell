import { signal, Text, View } from "nsh";

export default function R() {
  const liked = signal(false);
  return (
    <View class="gap-2 py-1">
      <Text class="text-sm text-zinc-700">{"You asked for: a weather card for Manila, sunny 31°C, with a small forecast row"}</Text>
      <View onPress={() => liked.update((v) => !v)} activeOpacity={0.6} class="self-start rounded-lg bg-zinc-100 px-3 py-1.5">
        <Text class="text-sm">{liked() ? "♥ liked" : "♡ like"}</Text>
      </View>
    </View>
  );
}
