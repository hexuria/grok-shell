import { signal, Text, View } from "nsh";

export default function R() {
  const count = signal(0);

  return (
    <View class="flex flex-row items-center justify-center p-4 border border-gray-300 rounded-lg">
      <View onPress={() => count.update(c => c - 1)} class="bg-blue-500 rounded-full p-2">
        <Text class="text-white">-</Text>
      </View>
      <Text class="mx-4 text-lg font-bold">{count()}</Text>
      <View onPress={() => count.update(c => c + 1)} class="bg-blue-500 rounded-full p-2">
        <Text class="text-white">+</Text>
      </View>
    </View>
  );
}