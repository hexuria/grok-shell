import { Text, View } from "nsh";

const days = ["M", "T", "W", "T", "F", "S", "S"];
const vals = [42, 68, 35, 90, 74, 20, 55];

export default function R() {
  return (
    <View class="gap-2 py-2">
      <Text class="text-sm font-semibold text-zinc-800">Sessions this week</Text>
      <View class="h-32 flex-row items-end gap-2">
        <Each of={vals}>{(v, i) => (
          <View class="flex-1 items-center gap-1">
            <View class="w-full rounded-t-md bg-blue-500" style={{ height: v() }} />
            <Text class="text-[10px] text-zinc-500">{days[i()]}</Text>
          </View>
        )}
        </Each>
      </View>
    </View>
  );
}
