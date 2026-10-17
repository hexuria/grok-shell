import { signal, Text, View } from "nsh";

export default function R() {
  const x = signal(3);
  const y = signal(4);
  // Derived: re-evaluated on every read, always consistent with x and y
  const r2 = () => x() * x() + y() * y();
  const r = () => Math.sqrt(r2());

  const Btn = (label: string, onPress: () => void) => (
    <View onPress={onPress} activeOpacity={0.7} class="px-3 py-2 rounded-lg bg-blue-600 items-center">
      <Text class="text-white font-bold">{label}</Text>
    </View>
  );

  return (
    <View class="flex flex-col gap-3 p-4 rounded-xl bg-gray-900">
      <Text class="text-white font-bold text-lg">Signals vs derived values</Text>

      <View class="flex flex-row gap-2 items-center">
        <Text class="text-gray-300 flex-1">x = {x()}</Text>
        {Btn("x+1", () => x.update(v => v + 1))}
        {Btn("x-1", () => x.update(v => v - 1))}
      </View>

      <View class="flex flex-row gap-2 items-center">
        <Text class="text-gray-300 flex-1">y = {y()}</Text>
        {Btn("y+1", () => y.update(v => v + 1))}
        {Btn("y-1", () => y.update(v => v - 1))}
      </View>

      <View class="p-3 rounded-lg bg-gray-800 flex flex-col gap-1">
        <Text class="text-green-400">r² = x² + y² = {r2()}</Text>
        <Text class="text-green-400">r = {r().toFixed(2)}</Text>
        <Text class="text-gray-500 text-xs">Derived values update automatically when x or y change.</Text>
      </View>
    </View>
  );
}