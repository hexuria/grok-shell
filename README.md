# Grok Shell

A native desktop chat app whose UI is **generated at runtime** — you describe
what you want, the model writes a TSX module, and it compiles, hot-patches and
renders as real native UI inside the conversation. No web views, no DOM: every
surface is an actual AppKit view.

Built for **UI/UX parity with Grok Bot** (the "Sand" desktop agent) — not a
lookalike, but measured parity: its design tokens were extracted from the
production bundle, and its avatar motion system runs verbatim, painted by our
own native renderer.

## Tech stack

- **Native Shell (nsh)** — Rust + QuickJS runtime. App code is TypeScript/TSX,
  compiled to bytecode, rendered by a native backend (macOS: AppKit, one
  `NSView` per node, CoreText, Core Animation). Signals/memos/effects reactive
  graph, Taffy layout, canvas, native animations. We run our fork of
  longbridge/nsh (PR #61: `Window.setFrame` / `setLevel`).
- **`tools/gen-server.mjs`** — the agent loop (Node.js). Per message it runs a
  tool loop (`generate_app`, `generate_image`, `web_search`, `fetch_url`,
  `query_source`, `office_*`…), typechecks each generated widget into
  `generated/R<N>.tsx`, and the dev server hot-patches it into the running
  app. Plain questions get text answers — UI is one tool among several.
- **Inference** — Anthropic Messages API when `ANTHROPIC_API_KEY` is set
  (default `claude-haiku-5-5`); per-thread model picks route through
  **opencodex** (`OPENCODEX_URL`, default `http://localhost:8080`). Any
  OpenAI-compatible endpoint works via `GEN_BASE_URL`/`GEN_MODEL` (OpenRouter
  by default). `MOCK=1` runs fully offline.
- **Persistence** — `generated/app.db` (SQLite via `node:sqlite`): bots,
  threads, turns, widget state, and the `apps` metadata table (display
  title/filename per artifact, owned per bot; published Mini Apps survive bot
  deletion).
- **Mini Apps** — generated widgets are first-class: publishable, pinnable,
  share state through the server's `/state` store across surfaces (chat card,
  pop-out window, sidebar shelf).
- **BetterOffice** — real `.docx`/`.xlsx`/`.pptx` generated in-process by the
  `@betteroffice/*` wasm engines, browsed/edited through a bundled MCP server,
  rendered in a WKWebView page that paints the engines' own display lists.
- **WidgetKit** — `native-widget/` hosts generated cards in a real macOS
  widget extension, the first step toward promotion outside the app.

## Running the app

Requirements: macOS, Node ≥ 22.6 (the office MCP child runs TypeScript via
`--experimental-transform-types`), and the nsh toolchain (our patched
checkout, or the `nsh` CLI on `PATH`).

```sh
npm install          # server deps + BetterOffice engines
tools/start.sh       # gen server (127.0.0.1:8787) + Native Shell host
```

`tools/start.sh` resolves the nsh binary as `$NSH`, then
`<nsh repo>/target/release/nsh` (release first — the debug host is several
times slower on the UI thread), then debug, then `nsh` on `PATH`. It pulls
`ANTHROPIC_API_KEY` from `secret get` if the env var isn't set, and reuses an
already-running server instead of starting a second one.

To run the pieces by hand:

```sh
node tools/gen-server.mjs            # agent loop on :8787
nsh run App.tsx --target macos       # dev server + host window, hot reload
nsh dev App.tsx --port 8791          # dev server only (see worktrees below)
nsh check App.tsx                    # typecheck
nsh build App.tsx                    # typecheck + bundle into out/
MOCK=1 node tools/gen-server.mjs     # offline: canned widgets, no API key
```

Server environment variables: `PORT` (default `8787`), `GEN_PROVIDER`,
`GEN_BASE_URL`, `GEN_MODEL`, `GEN_MAX_TOKENS`, `OPENCODEX_URL`,
`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `NSH` (nsh binary used for widget
typechecks and pop-outs), `POP_W`/`POP_H` (pop-out sizing), `MOCK`.

### In the app

- **Slash commands** — `/status:<state>` drives the avatar through any agent
  state without a model call; `/status:demo` cycles the whole table,
  `/status:off` clears. `/mock files` emits sample file cards (the office
  samples come from `tools/office/seeds/`).
- **Mini Apps** — `save` under a generated app publishes it to the shelf.
  Right-click a Library row to rename its display title or filename, or to
  open it in a pop-out window. Deleting a bot deletes its threads and
  generated artifacts, except ones published to Mini Apps.
- **The composer attaches files** — office documents attached to a message
  are read into the model's context (see BetterOffice below).

The generation server listens on `127.0.0.1:8787` (`/chat`, `/models`,
`/state/:name`, `/data/…`, `/file/…`, `/office/…`). Generated widgets may only
fetch that host — the sandbox blocks everything else.

## Working across git worktrees

Two agents (or two branches) often need separate running apps. The layout
supports it, with caveats.

```sh
git worktree add ../gen-ui-chat-<name> <branch>
cd ../gen-ui-chat-<name> && npm install
```

**State is isolated per worktree.** Each checkout has its own
`node_modules/`, `generated/app.db`, and `generated/R*.tsx` artifacts — bots,
chat history, library and Mini Apps don't cross. That's usually what you
want; it's also why "my apps are gone" means you're looking at the other
worktree's app.

**Only one generation server can bind :8787**, and several URLs are
hardwired to it: `GEN` in `App.tsx` and `fileviewer.tsx`, the system prompt's
widget fetch URL, and every already-generated `R*.tsx`. So:

- The worktree that owns :8787 is the **primary** — full feature set (chat,
  mini-app state, file viewer, office viewer all reach it).
- A second worktree gets chat-only on another port:

  ```sh
  PORT=8789 node tools/gen-server.mjs
  # then point the GEN consts in App.tsx/fileviewer.tsx at :8789 —
  # keep that as a local, uncommitted change
  ```

  Its generated widgets and office/file links will still hit :8787 (the
  other worktree's server). Don't be surprised when an artifact or file
  opens the wrong worktree's data — that's the port, not a bug.

- `tools/start.sh` reuses **any** server answering `/widget-feed` on :8787 —
  it can't tell which worktree it belongs to. When two worktrees are in
  play, start servers explicitly with `PORT=…` instead of relying on it.

**The dev server auto-picks a free port** (8790, 8791, …), so `nsh run` in
two worktrees mostly just works — but you can't tell the windows apart. To
label a second instance, run the pieces yourself:

```sh
nsh dev App.tsx --port 8791
nsh-macos-host --dev-server ws://127.0.0.1:8791/ws --name "My Branch"
```

**One cargo target dir, one host binary.** Two worktrees sharing the same
nsh checkout share `target/` — concurrent `nsh run`s serialize on the build
lock (long stalls), and a rebuild that replaces the host binary can SIGKILL
a running host (`exited with signal: 9`). Cheapest fix: `cp -R` (or a second
checkout of) the nsh repo and the built `target/release/{nsh,nsh-macos-host}`
per worktree, or just build once before starting both.

## BetterOffice

Office files are real, editable documents — not previews.

- **Generate** — "make a one-page memo as a Word doc", "a budget
  spreadsheet", "a 3-slide deck". The model calls the office tools; the
  engines produce real `.docx`/`.xlsx`/`.pptx` bytes and the reply carries a
  file card.
- **View & edit** — clicking an office file opens `/office/?path=…` in a
  WebView that paints the engines' display lists (slides and sheets render
  properly). With the editor bundle built, it opens the bundled BetterOffice
  editor instead of the read-only viewer.
- **Follow-up edits** — the bundled MCP server (`tools/office/mcp-main.ts`)
  is spawned lazily on the first `office_*` tool call; the model edits
  existing documents through it.
- **Attach** — dropping a `.docx`/`.xlsx`/`.pptx` on the composer lets the
  model answer questions about its contents.

Setup:

```sh
npm install                  # pulls @betteroffice/* engines + MCP SDK
npm run build:office-editor  # editing chrome → tools/office/editor/dist
```

The editor bundle is optional — if it's missing when the server starts, the
server esbuilds it in the background (first editor open may fall back to the
read-only viewer once). Everything degrades: no npm packages, no wasm, or a
dead MCP child → the `office_*` tools simply drop out of the tool list and
file viewing falls back to the classic renderers.

> **Note:** `nsh check` currently trips on `import.meta.resolve` in
> `tools/office/wasm.ts` — it typechecks the Node server scripts too. Known
> and cosmetic; `nsh build` and the app itself are unaffected.

## Grok Bot parity

The mark: `design/grok-bot.md` + `design/grok-tokens.json` hold the extracted
token set (type ramp, spacing grid, radii, neutral ramps for both themes).

Beyond static tokens, the avatar runs Grok Bot's own motion code:

- **`motion.mjs`** — Grok Bot's mark motion system extracted verbatim from its
  renderer bundle (acorn dependency closure): the engine (28 keyframe clips with
  bridging, pointer gaze, pokes, shape crossfades, face morphs, ambient morphs
  like the writing stylus), the state director and state table, and the frame
  renderer. `markpaint.ts` paints each frame's SVG tree onto an nsh canvas.
- **`blob.tsx`** — one engine per avatar placement, ticked at Grok's 30fps:
  idle marks rest and turn toward the pointer the way Grok's do; active marks
  play their state. Grok's silhouette solver is too heavy for QuickJS (10–40ms
  a frame, seconds on some poses), so outlines come pre-solved by the same
  engine: `atlas.data.ts` (every pose, via `markatlas.mjs` answering the
  engine's own outline cache; `tools/grok-mark/bake-atlas.mjs`) and, for
  resting/hovered marks, `rest.data.ts` (`tools/grok-mark/bake-rest.mjs`).
- **Agent states** — tool calls map to Grok's activity verbs (`generate_app` →
  writing, `web_search` → searching, …) and on to its mark states; the bot's
  sidebar mark (row, pinned tile, rail) and the status row play them — like
  Grok, the header and info-pane avatars stay at rest — and `/status:<state>`
  mock commands exercise the whole table without a generation.
- Light/dark themes both supported via `theme.ts` (`tc()` maps dark neutrals to
  Sand's light ramp).

## Roadmap

- **Desktop parity first** — 100% UI/UX parity with Grok Bot is the current
  focus; everything else is secondary until that's done.
- **opengrok-server** — replace the opencodex inference path.
- **Mobile** — the same Native Shell TSX code targets iOS (`NshAppView`);
  the mobile app reuses this codebase once desktop parity lands.

## License

MIT — see `LICENSE`. Vendored/extracted components keep their own licenses;
BetterOffice packages are Apache-2.0.
