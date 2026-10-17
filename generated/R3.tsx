import { signal, Text, View, Scroll } from "nsh";

export default function R() {
  const data = signal([30, 70, 50, 90, 60]);
  const maxValue = Math.max(...data());

  return (
    <View class="p-4">
      <Text class="font-bold text-lg mb-2">Bar Chart</Text>
      <Scroll class="flex flex-row gap-2 overflow-hidden">
        <Each of={data()}>{(item, i) => (
          <View class="flex-1">
            <View
              class={`bg-blue-500 h-${(item() / maxValue) * 100} rounded`}
              style={{ width: '100%' }}
            />
            <Text class="text-center text-sm">{item()}</Text>
          </View>
        )}</Each>
      </Scroll>
    </View>
  );
}