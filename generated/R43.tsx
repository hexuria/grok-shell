import { signal, Text, View, Scroll, Input } from "nsh";

const API = "http://127.0.0.1:8787";

export default function R() {
  const issues = signal<any[]>([]);
  const scopeLabel = signal("");
  const failed = signal(false);
  const loading = signal(true);
  const teams = signal<any[]>([]);
  const selUid = signal("");
  const busy = signal(false);
  const note = signal("");
  const comment = signal("");

  const selected = (): any => issues().find((x: any) => x.uid === selUid()) || null;

  const loadIssues = () => {
    loading.set(true);
    failed.set(false);
    fetch(`${API}/data/linear/issues`)
      .then((r) => r.json())
      .then((d: any) => {
        if (!d || d.error || !Array.isArray(d.issues)) throw new Error("bad");
        issues.set(d.issues);
        scopeLabel.set(d.scope === "assigned" ? "Assigned to you" : "Recent in workspace");
        loading.set(false);
      })
      .catch(() => {
        failed.set(true);
        loading.set(false);
      });
  };

  const loadStates = () => {
    fetch(`${API}/data/linear/states`)
      .then((r) => r.json())
      .then((d: any) => {
        if (d && Array.isArray(d.teams)) teams.set(d.teams);
      })
      .catch(() => {});
  };

  const statesFor = (): any[] => {
    const s = selected();
    if (!s) return [];
    const t: any = teams().find((x: any) => x.team === s.team);
    return t ? t.states : [];
  };

  const mutate = (path: string, body: any, okMsg: string) => {
    busy.set(true);
    note.set("");
    fetch(`${API}/data/linear/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((d: any) => {
        note.set(d && d.error ? "Failed: " + d.error : okMsg);
        busy.set(false);
        loadIssues();
      })
      .catch(() => {
        note.set("Request failed");
        busy.set(false);
      });
  };

  const setState = (stateId: string) => {
    const s = selected();
    if (s) mutate("update", { uid: s.uid, stateId }, "State updated");
  };

  const assignMe = () => {
    const s = selected();
    if (s) mutate("assign", { uid: s.uid }, "Assigned to you");
  };

  const postComment = () => {
    const s = selected();
    const body = comment().trim();
    if (!s || !body) return;
    comment.set("");
    mutate("comment", { uid: s.uid, body }, "Comment posted");
  };

  loadIssues();
  loadStates();

  return (
    <View class="flex-col gap-3 p-4 bg-white rounded-xl border border-gray-200 w-full">
      <View class="flex-row items-center justify-between">
        <View class="flex-col">
          <Text class="text-lg font-bold text-gray-900">Linear issues</Text>
          <Text class="text-xs text-gray-500">{scopeLabel()}</Text>
        </View>
        <View onPress={loadIssues} activeOpacity={0.7} class="px-3 py-1 rounded-md bg-gray-100">
          <Text class="text-xs font-semibold text-gray-700">Refresh</Text>
        </View>
      </View>

      <If when={loading()}>
        <Text class="text-sm text-gray-500">Loading…</Text>
      </If>

      <If when={failed()}>
        <View class="flex-row items-center justify-between">
          <Text class="text-sm text-red-600">Couldn't load issues</Text>
          <View onPress={loadIssues} activeOpacity={0.7} class="px-3 py-1 rounded-md bg-red-50">
            <Text class="text-xs font-semibold text-red-700">Retry</Text>
          </View>
        </View>
      </If>

      <If when={!loading() && !failed() && issues().length === 0}>
        <Text class="text-sm text-gray-500">No issues found.</Text>
      </If>

      <Scroll class="max-h-64">
        <View class="flex-col gap-1">
          <Each of={issues()}>
            {(item: any) => (
              <View
                onPress={() => {
                  selUid.set(item().uid);
                  note.set("");
                }}
                activeOpacity={0.7}
                class={
                  "flex-row items-center gap-2 p-2 rounded-lg " +
                  (selUid() === item().uid ? "bg-indigo-50 border border-indigo-300" : "bg-gray-50")
                }
              >
                <Text class="text-xs font-mono text-gray-500">{item().id}</Text>
                <Text class="text-sm text-gray-900 flex-1">{item().title}</Text>
                <Text class="text-xs text-gray-500">{item().state}</Text>
              </View>
            )}
          </Each>
        </View>
      </Scroll>

      <If when={selected() !== null}>
        <View class="flex-col gap-3 pt-3 border-t border-gray-200">
          <View class="flex-col gap-1">
            <Text class="text-sm font-semibold text-gray-900">{selected() ? selected().id + " · " + selected().title : ""}</Text>
            <Text class="text-xs text-gray-500">
              {selected() ? (selected().team || "") + " · " + (selected().assignee || "Unassigned") : ""}
            </Text>
          </View>

          <View class="flex-col gap-2">
            <Text class="text-xs font-semibold text-gray-600">Change state</Text>
            <View class="flex-row flex-wrap gap-2">
              <Each of={statesFor()}>
                {(st: any) => (
                  <View
                    onPress={() => setState(st().id)}
                    activeOpacity={0.7}
                    class={
                      "px-2 py-1 rounded-md " +
                      (selected() && selected().state === st().name ? "bg-indigo-600" : "bg-gray-100")
                    }
                  >
                    <Text
                      class={
                        "text-xs font-medium " +
                        (selected() && selected().state === st().name ? "text-white" : "text-gray-700")
                      }
                    >
                      {st().name}
                    </Text>
                  </View>
                )}
              </Each>
            </View>
          </View>

          <View class="flex-row gap-2">
            <View onPress={assignMe} activeOpacity={0.7} class="px-3 py-2 rounded-md bg-gray-900">
              <Text class="text-xs font-semibold text-white">Assign to me</Text>
            </View>
          </View>

          <View class="flex-col gap-2">
            <Text class="text-xs font-semibold text-gray-600">Comment</Text>
            <View class="flex-row items-center gap-2">
              <Input
                value={comment()}
                onChangeText={(v: string) => comment.set(v)}
                placeholder="Write a comment…"
                class="flex-1 px-2 py-2 rounded-md border border-gray-300 text-sm"
              />
              <View onPress={postComment} activeOpacity={0.7} class="px-3 py-2 rounded-md bg-indigo-600">
                <Text class="text-xs font-semibold text-white">Post</Text>
              </View>
            </View>
          </View>
        </View>
      </If>

      <If when={busy()}>
        <Text class="text-xs text-gray-500">Working…</Text>
      </If>
      <If when={note() !== ""}>
        <Text class="text-xs text-gray-700">{note()}</Text>
      </If>
    </View>
  );
}