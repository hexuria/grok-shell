import { signal, effect, cleanup, Text, View, Scroll } from "nsh";

type Issue = { uid: string; id: string; title: string; state: string; priority: number; team: string; url: string };

export default function R() {
  const issues = signal<Issue[]>([]);
  const err = signal("");
  const loading = signal(true);

  const prioLabel = (p: number) => (["None", "Urgent", "High", "Medium", "Low"][p] ?? "None");

  const load = () => {
    loading.set(true);
    err.set("");
    fetch("http://127.0.0.1:8787/data/linear/issues")
      .then((r) => r.json())
      .then((d: any) => {
        if (d && d.error) { err.set(String(d.error)); }
        else { issues.set((d?.issues || []) as Issue[]); }
        loading.set(false);
      })
      .catch(() => { err.set("Couldn't load issues."); loading.set(false); });
  };

  effect(() => {
    load();
    const t = setInterval(load, 60000);
    cleanup(() => clearInterval(t));
  });

  return (
    <View class="flex flex-col gap-3 p-4 bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-700 min-h-40">
      <View class="flex flex-row items-center justify-between">
        <Text class="text-base font-bold text-gray-900 dark:text-gray-100">My Linear issues</Text>
        <View onPress={load} activeOpacity={0.7} class="px-2 py-1 rounded-md bg-gray-100 dark:bg-zinc-800">
          <Text class="text-xs text-gray-700 dark:text-gray-300">Refresh</Text>
        </View>
      </View>

      <If when={err()}>
        <View class="flex flex-col gap-2">
          <Text class="text-sm text-red-600 dark:text-red-400">{err()}</Text>
          <View onPress={load} activeOpacity={0.7} class="self-start px-3 py-1 rounded-md bg-gray-100 dark:bg-zinc-800">
            <Text class="text-xs text-gray-700 dark:text-gray-300">Retry</Text>
          </View>
        </View>
      </If>

      <If when={!err() && loading() && issues().length === 0}>
        <Text class="text-sm text-gray-500 dark:text-gray-400">Loading…</Text>
      </If>

      <If when={!err() && !loading() && issues().length === 0}>
        <Text class="text-sm text-gray-500 dark:text-gray-400">No assigned issues.</Text>
      </If>

      <Scroll class="max-h-96">
        <Each of={issues()}>
          {(item, i) => (
            <View class="flex flex-col gap-1 py-2 border-b border-gray-100 dark:border-zinc-800">
              <View class="flex flex-row items-center justify-between gap-2">
                <Text class="text-xs font-semibold text-indigo-600 dark:text-indigo-400">{item().id}</Text>
                <Text class="text-xs text-gray-500 dark:text-gray-400">{prioLabel(item().priority)}</Text>
              </View>
              <Text class="text-sm text-gray-900 dark:text-gray-100">{item().title}</Text>
              <View class="flex flex-row items-center justify-between">
                <Text class="text-xs text-gray-600 dark:text-gray-400">{item().state}</Text>
                <Text class="text-xs text-gray-400 dark:text-gray-500">{item().team}</Text>
              </View>
            </View>
          )}
        </Each>
      </Scroll>
    </View>
  );
}