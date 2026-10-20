# Grok Shell

A native desktop chat app whose UI is **generated at runtime** — you describe
what you want, the model writes a TSX module, and it compiles, hot-patches and
renders as real native UI inside the conversation. No web views, no DOM: every
surface is an actual AppKit view.

Built for **UI/UX parity with Grok Bot** (the "Sand" desktop agent) — not a
lookalike, but measured parity: its design tokens, animation clips and ambient
behaviors were extracted from the production bundle and re-implemented on our
own renderer.

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

Beyond static tokens, the avatar system runs Grok Bot's actual decoded data:

- **`clips.data.ts`** — the real 28-clip keyframe registry (Working, Streaming,
  Blocked, Done, Idle…): rotation/position/squash/zoom/lids/expression tracks
  with authored bezier eases, decoded from the bundle and played back live by
  `clips.ts` + `markeng.mjs` (a port of its own solid-geometry renderer).
- **`ambient.ts`** — the real ambient morph controller (`vx`/`Ix`/`DE`/`FE`):
  the mark's head physically transforms per agent state — dots, orbit, radar,
  progress, wave, pencil, bang, standby — including silhouette morphing toward
  ring/stadium targets and the swap crossfade.
- **`statusfx.tsx` + `blob.tsx`** — every bot surface (sidebar, pinned tiles,
  rail, header, status row) plays the live agent state; `/status:<state>` mock
  commands exercise the whole state table without a generation.
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
