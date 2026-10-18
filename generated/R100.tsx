import { signal, effect, cleanup, Text, View, mount } from "nsh";

const S = "R100";
const FOCUS = 25 * 60;
const BREAK = 5 * 60;

export default function R() {
  const mode = signal("focus");
  const remaining = signal(FOCUS);
  const running = signal(false);
  const sessions = signal(0);
  const minutesFocused = signal(0);
  let snap = "";

  const apply = (s: any) => {
    sessions.set(s?.sessions || 0);
    minutesFocused.set(s?.minutesFocused || 0);
  };

  const save = () => {
    const body = JSON.stringify({ sessions: sessions(), minutesFocused: minutesFocused() });
    snap = body;
    fetch(`http://127.0.0.1:8787/state/${S}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {});
  };

  // Restore once on mount
  fetch(`http://127.0.0.1:8787/state/${S}`)
    .then((r) => r.json())
    .then((d: any) => {
      if (d && d.state) {
        snap = JSON.stringify(d.state);
        apply(d.state);
      }
    })
    .catch(() => {});

  // Sync with other surfaces
  effect(() => {
    const t = setInterval(async () => {
      try {
        const d: any = await fetch(`http://127.0.0.1:8787/state/${S}`).then((r) => r.json());
        const s = JSON.stringify(d?.state || {});
        if (s !== "{}" && s !== snap) {
          snap = s;
          apply(d.state);
        }
      } catch {}
    }, 2000);
    cleanup(() => clearInterval(t));
  });

  const tick = () => {
    const r = remaining() - 1;
    if (r > 0) {
      remaining.set(r);
      return;
    }
    running.set(false);
    if (mode() === "focus") {
      sessions.update((n) => n + 1);
      minutesFocused.update((m) => m + 25);
      mode.set("break");
      remaining.set(BREAK);
    } else {
      mode.set("focus");
      remaining.set(FOCUS);
    }
    save();
  };

  // Tick aligned to wall-second boundaries while running
  effect(() => {
    if (!running()) return;
    let iv: number | undefined = undefined;
    const to: number = setTimeout(() => {
      tick();
      iv = setInterval(tick, 1000);
    }, 1000 - (Date.now() % 1000));
    cleanup(() => {
      clearTimeout(to);
      if (iv !== undefined) clearInterval(iv);
    });
  });

  const toggle = () => running.update((v) => !v);
  const reset = () => {
    running.set(false);
    mode.set("focus");
    remaining.set(FOCUS);
  };

  const mm = () => String(Math.floor(remaining() / 60)).padStart(2, "0");
  const ss = () => String(remaining() % 60).padStart(2, "0");
  const pct = () => {
    const total = mode() === "focus" ? FOCUS : BREAK;
    return (1 - remaining() / total) * 100;
  };

  return (
    <View class="flex flex-col gap-4 p-5 rounded-2xl bg-white border border-gray-200">
      <View class="flex flex-row justify-between items-center">
        <Text class="text-sm font-semibold text-gray-500">
          {mode() === "focus" ? "FOCUS" : "BREAK"}
        </Text>
        <Text class="text-sm text-gray-400">{`Sessions ${sessions()}`}</Text>
      </View>

      <Text class="text-6xl font-bold text-center text-gray-900">{`${mm()}:${ss()}`}</Text>

      <View class="h-2 rounded-full bg-gray-200 overflow-hidden">
        <View
          class={mode() === "focus" ? "h-2 bg-red-500 rounded-full" : "h-2 bg-green-500 rounded-full"}
          style={{ width: `${pct()}%` }}
        />
      </View>

      <View class="flex flex-row gap-3">
        <View
          class={running() ? "flex-1 items-center py-3 rounded-xl bg-gray-800" : "flex-1 items-center py-3 rounded-xl bg-red-500"}
          onPress={toggle}
          activeOpacity={0.7}
        >
          <Text class="font-semibold text-white">{running() ? "Pause" : "Start"}</Text>
        </View>
        <View
          class="flex-1 items-center py-3 rounded-xl bg-gray-100"
          onPress={reset}
          activeOpacity={0.7}
        >
          <Text class="font-semibold text-gray-700">Reset</Text>
        </View>
      </View>

      <Text class="text-xs text-center text-gray-400">{`${minutesFocused()} min focused total`}</Text>
    </View>
  );
}