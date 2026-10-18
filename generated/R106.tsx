import { signal, Text, View } from "nsh";
import { Image } from "nsh/image";

export default function R() {
  const failed = signal(false);
  return (
    <View class="gap-2">
      <If when={!failed()}>
        <Image src="asset:/generated/assets/img-1792322390880.png" resizeMode="cover" onError={() => failed.set(true)} class="h-64 w-full rounded-xl" />
      </If>
      <If when={failed()}>
        <Text class="text-sm text-zinc-500">image failed to load</Text>
      </If>
      <Text class="text-xs text-zinc-500" numberOfLines={2}>{"A cat astronaut floating weightlessly over neon-lit Tokyo at night, wearing a white space suit with a glass helmet, tail curling in zero gra"}</Text>
    </View>
  );
}
