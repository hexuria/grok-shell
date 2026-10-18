# Feature request: window control on `nsh/desktop`

**Use case.** We run generated widgets via `nsh run widget.tsx --target macos` as
standalone windows (a "pop-out" flow: a chat app freezes a module into a tiny
`mount()` wrapper and spawns it). They are desktop satellites of the chat app —
small, deliberately placed, theme-following.

**Shipped in our fork** (would upstream cleanly):

- `Window.setFrame({ x?, y?, width?, height?, animated?, anchorTop? })` —
  field-wise merge; `anchorTop` keeps the top edge fixed when only the height
  changes (macOS's bottom-left origin otherwise grows windows at their top).
- `Window.setLevel("normal" | "floating" | "desktopIcon")` — `desktopIcon` also
  sets `Stationary | CanJoinAllSpaces | IgnoresCycle` (a desktop widget is not
  a Mission Control window).
- `Window.orderFront()` — deminiaturize + `NSApp.activate()` + make key and
  order front. Needed because a spawned host process has no user-activation
  context: without it the window orders in behind, never key (grayed lights).
- `app.activate()` at launch replacing deprecated `activateIgnoringOtherApps`.
- `nsh run --name <name> --size <WxH>` — forwarded to the macOS host, so a
  pop-out is born at its final size with a distinct name (otherwise every
  spawned window is a second "Gen UI Chat" in Cmd-Tab / Mission Control).

**Still open** (upstream asks):

- `Window.frame()` / `device.screenSize()` reactive reads — today we compute a
  height cap on the server and bake it into the generated wrapper; the app
  cannot see its own frame or the screen.
- `Window.setStyle({ resizable?, nonactivating? })` — a `nonactivating` NSPanel
  mode for glanceable desktop surfaces that shouldn't steal focus; a resizable
  toggle for fixed-size content windows.
- One host process, N windows: every pop-out is currently a full dev session
  (`nsh run` → dev server + host process + Dock entry per window). Multi-window
  support in the host + a dev protocol that loads a second module in a second
  window would make pop-outs cheap satellites instead of N app clones.

Context: the wrappers want content-driven sizing — declared width
(`export const popoutWidth`, or exact `popoutSize`), measured height with a
debounce so transient "loading" renders don't collapse the window.
