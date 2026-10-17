import { signal, Text, View } from "nsh";

export default function R() {
  const total: number = 25 * 60;
  const left = signal<number>(total);
  const running = signal<boolean>(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    running.set(false);
  };

  const toggle = (): void => {
    if (running()) {
      stop();
      return;
    }
    if (left() <= 0) left.set(total);
    running.set(true);
    timer = setInterval(() => {
      const next: number = left() - 1;
      left.set(next > 0 ? next : 0);
      if (next <= 0) stop();
    }, 1000);
  };

  const reset = (): void => {
    stop();
    left.set(total);
  };

  const pad = (n: number): string => (n < 10 ? "0" + n : "" + n);

  return (
    <View class="flex flex-col gap-4 p-5 rounded-2xl bg-slate-900">
      <View class="flex flex-row justify-between items-center">
        <Text class="text-slate-400 text-sm font-semibold">Pomodoro</Text>
        <Text class="text-xs font-semibold text-rose-400">
          {left() === 0 ? "Done! Take a break" : running() ? "Focusing" : "Ready"}
        </Text>
      </View>

      <View class="items-center py-2">
        <Text class="text-6xl font-bold text-white">
          {pad(Math.floor(left() / 60)) + ":" + pad(left() % 60)}
        </Text>
      </View>

      <View class="h-2 rounded-full bg-slate-700 overflow-hidden">
        <View
          class="h-2 rounded-full bg-rose-500"
          style={{ width: (300 * left()) / total }}
        />
      </View>

      <View class="flex flex-row gap-3">
        <View
          class="flex-1 items-center py-3 rounded-xl bg-rose-500"
          onPress={toggle}
          activeOpacity={0.7}
        >
          <Text class="font-semibold text-white">
            {running() ? "Pause" : left() < total && left() > 0 ? "Resume" : "Start"}
          </Text>
        </View>
        <View
          class="flex-1 items-center py-3 rounded-xl bg-slate-700"
          onPress={reset}
          activeOpacity={0.7}
        >
          <Text class="font-semibold text-slate-200">Reset</Text>
        </View>
      </View>
    </View>
  );
}