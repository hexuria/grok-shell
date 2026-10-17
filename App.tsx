import {
  cleanup,
  effect,
  Input,
  mount,
  Scroll,
  signal,
  Text,
  View,
  type YNode,
} from "nsh";
import { isAvailable, Menu, titleBar, Window } from "nsh/desktop";
import { KeyboardAvoidingView, SafeAreaView } from "nsh/ui/mobile";
import { Conversation } from "./generated/index";
import { WidgetShelf } from "./widgets/index";

const GEN = "http://127.0.0.1:8787";

const PHASE_ICON: Record<string, string> = {
  queued: "…",
  thinking: "🧠",
  writing: "✍️",
  checking: "🔍",
  retrying: "♻️",
  fallback: "⚠️",
  publishing: "🚀",
  done: "✓",
};

const SUGGESTIONS = [
  "tetris with automatic gravity drawn on a Canvas",
  "a weather card for Manila with a 5-day forecast row",
  "a pomodoro timer with start, pause and reset",
  "a stock card for NVDA with a mini sparkline",
];

type ThreadMeta = { id: string; title: string; count: number };

function App() {
  const draft = signal("");
  const inflight = signal(0);
  const status = signal(
    "describe a UI — a fresh TSX module is generated, checked, and hot-patched in",
  );
  const threads = signal<ThreadMeta[]>([]);
  const activeId = signal("");
  const model = signal("…");
  const sidebarOpen = signal(true);
  const tab = signal("chat");
  let scroller!: YNode;

  const scrollToEnd = () =>
    setTimeout(() => scroller?.scrollTo({ y: 1_000_000, animated: true }), 60);

  const refreshThreads = async () => {
    const d = await fetch(`${GEN}/threads`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (d) {
      threads.set(d.list);
      activeId.set(d.active);
      model.set(d.model);
    }
  };
  refreshThreads();
  effect(() => {
    const t = setInterval(refreshThreads, 2500);
    cleanup(() => clearInterval(t));
  });

  const activeCount = () =>
    threads().find((t) => t.id === activeId())?.count ?? -1;

  const run = async (prompt: string) => {
    inflight.update((n) => n + 1);
    status.set("sending to the generator…");
    try {
      const r = await fetch(`${GEN}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!r.ok) throw new Error(`generator answered ${r.status}`);
      const { id } = await r.json();
      // poll this job until the pipeline finishes (think→write→check→publish)
      for (let fails = 0; ; ) {
        await new Promise((res) => setTimeout(res, 400));
        const s = await fetch(`${GEN}/status?id=${id}`)
          .then((x) => (x.ok ? x.json() : null))
          .catch(() => null);
        if (!s) {
          if (++fails > 15) throw new Error("lost the generator");
          continue;
        }
        fails = 0;
        const extra =
          inflight() > 1 ? ` · ${inflight()} generations running` : "";
        status.set(
          `${PHASE_ICON[s.phase] ?? "…"} ${s.detail || s.phase}${extra}`,
        );
        if (s.done) break;
      }
      refreshThreads();
    } catch (e) {
      status.set(`no generator — run  node tools/gen-server.mjs  (${String(e)})`);
    }
    inflight.update((n) => n - 1);
    scrollToEnd();
  };

  const send = () => {
    const prompt = draft().trim();
    if (!prompt) return;
    draft.set("");
    run(prompt);
  };

  const post = (path: string, body?: object) =>
    fetch(`${GEN}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);

  const newThread = async () => {
    await post("/thread/new");
    tab.set("chat");
    await refreshThreads();
  };
  const selectThread = async (id: string) => {
    if (id === activeId()) return;
    tab.set("chat");
    await post("/thread/select", { id });
    await refreshThreads();
    scrollToEnd();
  };
  const surprise = () =>
    draft.set(SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)]);

  // macOS: hide the system title bar and draw our own — the traffic lights
  // stay, centered in the 44pt strip `titleBar()` reports. Real app menu too.
  if (isAvailable) {
    Window.setTitle("Gen UI Chat");
    Window.setTitleBar("hidden", 44);
    Menu.setApplicationMenu([
      {
        label: "Gen UI Chat",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "showAll" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "File",
        submenu: [
          { label: "New Chat", shortcut: "mod+n", onSelect: newThread },
          { type: "separator" },
          { role: "close" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Toggle Sidebar",
            shortcut: "mod+shift+s",
            onSelect: () => sidebarOpen.update((v) => !v),
          },
          { type: "separator" },
          { role: "toggleFullScreen" },
        ],
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "zoom" }],
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#171717" }}>
      <View style={{ flex: 1 }}>
        {/* ————— custom title bar (system traffic lights overlay the left end) ————— */}
        <View
          desktop={{ windowDrag: true }}
          style={{
            height: 44,
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "#171717",
          }}
        >
          <View style={{ width: titleBar().left }} />
          <View
            onPress={() => sidebarOpen.update((v) => !v)}
            activeOpacity={0.7}
            accessibilityLabel="toggle sidebar"
            style={{
              padding: 7,
              borderRadius: 7,
              marginHorizontal: 4,
              backgroundColor: sidebarOpen() ? "#2f2f2f" : "transparent",
            }}
          >
            {/* sidebar glyph drawn as views: a rounded square with a filled left panel */}
            <View
              style={{
                width: 17,
                height: 13,
                borderRadius: 4,
                borderWidth: 1.4,
                borderColor: "#8e8e93",
                flexDirection: "row",
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: 5.5,
                  backgroundColor: "#8e8e93",
                }}
              />
            </View>
          </View>
          <View style={{ flex: 1, alignItems: "center" }}>
            <View
              style={{
                flexDirection: "row",
                backgroundColor: "#0e0e0e",
                borderRadius: 999,
                padding: 3,
              }}
            >
              <View
                onPress={() => tab.set("chat")}
                activeOpacity={0.7}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 16,
                  paddingVertical: 4,
                  backgroundColor: tab() === "chat" ? "#2f2f2f" : "transparent",
                }}
              >
                <Text
                  style={{
                    color: tab() === "chat" ? "#ececec" : "#8e8e93",
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  Chat
                </Text>
              </View>
              <View
                onPress={() => tab.set("work")}
                activeOpacity={0.7}
                style={{
                  borderRadius: 999,
                  paddingHorizontal: 16,
                  paddingVertical: 4,
                  backgroundColor: tab() === "work" ? "#2f2f2f" : "transparent",
                }}
              >
                <Text
                  style={{
                    color: tab() === "work" ? "#ececec" : "#8e8e93",
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  Work
                </Text>
              </View>
            </View>
          </View>
          <View
            onPress={async () => {
              await post("/share/thread");
              status.set("transcript + module sources copied to clipboard");
            }}
            activeOpacity={0.7}
            accessibilityLabel="share thread"
            style={{ padding: 7, marginHorizontal: 6 }}
          >
            <Text style={{ color: "#8e8e93", fontSize: 15 }}>⤴</Text>
          </View>
        </View>

        <View style={{ flex: 1, flexDirection: "row" }}>
        {/* ————— sidebar ————— */}
        <If when={sidebarOpen()}>
        <View
          style={{
            width: 236,
            backgroundColor: "#171717",
            paddingHorizontal: 10,
            paddingVertical: 10,
          }}
        >
          <View class="flex-row items-center justify-between px-2 pb-2">
            <Text style={{ color: "#ececec", fontSize: 15, fontWeight: "600" }}>
              Gen UI Chat
            </Text>
            <Text style={{ color: "#6e6e73", fontSize: 12 }}>nsh</Text>
          </View>
          <View
            onPress={newThread}
            activeOpacity={0.7}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 9,
              backgroundColor: "#262626",
            }}
          >
            <Text style={{ color: "#ececec", fontSize: 14 }}>✎</Text>
            <Text style={{ color: "#ececec", fontSize: 14 }}>New chat</Text>
          </View>
          <Text
            style={{
              color: "#6e6e73",
              fontSize: 11,
              fontWeight: "600",
              paddingHorizontal: 10,
              paddingTop: 18,
              paddingBottom: 6,
            }}
          >
            RECENTS
          </Text>
          <Scroll style={{ flex: 1 }}>
            <View class="gap-1">
              <Each of={threads()}>
                {(t) => (
                  <View
                    onPress={() => selectThread(t().id)}
                    activeOpacity={0.7}
                    style={{
                      borderRadius: 8,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      backgroundColor:
                        t().id === activeId() ? "#2f2f2f" : "transparent",
                    }}
                  >
                    <Text style={{ color: "#ececec", fontSize: 13 }}>
                      {t().title}
                    </Text>
                    <Text style={{ color: "#6e6e73", fontSize: 11 }}>
                      {t().count} messages
                    </Text>
                  </View>
                )}
              </Each>
            </View>
          </Scroll>
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: "#2a2a2a",
              paddingTop: 10,
              paddingHorizontal: 6,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: "#10a37f",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>
                UI
              </Text>
            </View>
            <View>
              <Text style={{ color: "#ececec", fontSize: 12 }}>{model()}</Text>
              <Text style={{ color: "#6e6e73", fontSize: 10 }}>
                local generator · :8787
              </Text>
            </View>
          </View>
        </View>
        </If>

        {/* ————— main ————— */}
        <View style={{ flex: 1, backgroundColor: "#212121" }}>
          <If when={tab() === "chat" && activeCount() === 0}>
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 26,
                paddingHorizontal: 40,
              }}
            >
              <Text
                style={{ color: "#ececec", fontSize: 24, fontWeight: "600" }}
              >
                What's on the agenda today?
              </Text>
              <View class="gap-2 self-stretch">
                <Each of={SUGGESTIONS}>
                  {(s) => (
                    <View
                      onPress={() => run(s())}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: "#2f2f2f",
                        paddingHorizontal: 14,
                        paddingVertical: 11,
                      }}
                    >
                      <Text style={{ color: "#8e8e93", fontSize: 13 }}>✦</Text>
                      <Text style={{ color: "#d4d4d8", fontSize: 14 }}>
                        {s()}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
            </View>
          </If>
          <If when={tab() === "chat" && activeCount() !== 0}>
            <Scroll
              ref={scroller}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* onLayout fires whenever the patched conversation grows */}
              <View
                onLayout={scrollToEnd}
                style={{ alignSelf: "center", width: "100%", maxWidth: 760 }}
              >
                <Conversation />
              </View>
            </Scroll>
          </If>
          <If when={tab() === "work"}>
            <Scroll style={{ flex: 1 }}>
              <View style={{ alignSelf: "center", width: "100%", maxWidth: 760 }}>
                <WidgetShelf />
              </View>
            </Scroll>
          </If>

          <View class="px-4 py-1">
            <Text style={{ color: "#6e6e73", fontSize: 11 }}>{status()}</Text>
          </View>

          <KeyboardAvoidingView>
            <View class="px-3 pb-3">
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 8,
                  backgroundColor: "#2f2f2f",
                  borderRadius: 28,
                  paddingLeft: 14,
                  paddingRight: 8,
                  paddingVertical: 8,
                }}
              >
                <View
                  onPress={surprise}
                  activeOpacity={0.7}
                  style={{ paddingBottom: 7 }}
                >
                  <Text style={{ color: "#b4b4b4", fontSize: 18 }}>＋</Text>
                </View>
                <Input
                  value={draft()}
                  onChangeText={(t) => draft.set(t)}
                  placeholder="Ask for a UI…"
                  placeholderTextColor="#8e8e93"
                  multiline
                  submitBehavior="submit"
                  returnKeyType="send"
                  onSubmitEditing={send}
                  style={{
                    flex: 1,
                    fontSize: 15,
                    maxHeight: 120,
                    color: "#ececec",
                    paddingVertical: 8,
                  }}
                />
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingBottom: 4,
                  }}
                >
                  <Text style={{ color: "#8e8e93", fontSize: 12 }}>
                    {model()} ⌄
                  </Text>
                  <View
                    onPress={send}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: "#ececec",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#171717",
                        fontSize: 16,
                        fontWeight: "700",
                      }}
                    >
                      ↑
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

mount(App);
