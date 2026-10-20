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
  graph, Taffy layout, canvas, native animations.
- **`tools/gen-server.mjs`** — the agent loop (Node.js). Per message it runs a
  tool loop (`generate_app`, `generate_image`, `web_search`, `fetch_url`,
  `query_source`), typechecks each generated widget into `generated/r<N>.tsx`,
  and the dev server hot-patches it into the running app. Plain questions get
  text answers — UI is one tool among several, not the only reply format.
- **Inference** — currently **opencodex** (Anthropic-compatible endpoint). Will
  be ported to **opengrok-server**. `OPENROUTER_API_KEY` is an optional
  fallback path; `MOCK=1` runs fully offline.
- **Mini Apps** — generated widgets are first-class: publishable, pinnable,
  share state through the server's `/state` store across surfaces (chat card,
  pop-out window, sidebar shelf).
- **WidgetKit** — `native-widget/` hosts generated cards in a real macOS
  widget extension, the first step toward promotion outside the app.

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

## Run it

```sh
tools/start.sh                      # gen server + Native Shell host (macOS)
MOCK=1 node tools/gen-server.mjs    # offline: canned widgets, no API key
nsh run App.tsx --target macos      # app only, hot reload
nsh build App.tsx                   # typecheck + bundle into out/
```

The generation server listens on `127.0.0.1:8787` (`/chat`, `/models`,
`/state/:name`, `/data/…`). Generated widgets may only fetch that host — the
sandbox blocks everything else.

`/status:thinking`, `/status:working`, `/status:demo` … in the composer cycle
the avatar through every agent-state animation for testing.
