# Grok Bot design system — extracted

Source: `/Applications/Grok Bot.app` v0.71.2 (bundle `com.anysphere.sand`, Electron, `app.asar` — analyzed with `rea-agents@6.7.0` + direct bundle inspection). The app is "Sand", Cursor's Grok desktop agent. Two token layers: primitives (raw ramps) → semantic roles (semantic = primitive or primitive@opacity).

Use this file to make generated apps/surfaces look native to Grok Bot. JSON version of the tokens: `grok-tokens.json`.

## Typography

- Sans: `"SF Pro"` → fallback `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Mono: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
- Icon font: `cursor-icons-16` (16px), brand mark font `X` (variable)

| Token | size | line-height | letter-spacing |
|---|---|---|---|
| xxs | 11 | 16 | .005em |
| xs | 12 | 16 | 0 |
| sm | 13 | 18 | 0 |
| base | 14 | 20 | 0 |
| lg | 15 | 22 | 0 |
| xl | 17 | 24 | -.008em |
| xxl | 22 | 28 | -.012em |
| xxxl | 26 | 32 | -.015em |

Weights: regular 400 / medium 500 / semibold 600. Prose (transcript): 22px line-height, 7px block padding.

## Spacing & layout

4px base grid: `0.25=1 0.5=2 0.75=3 1=4 1.25=5 1.5=6 1.75=7 2=8 2.25=9 2.5=10 2.75=11 3=12 … step of 1 up to 20=80` (+ matching negative set).

Control heights: xs 20 · sm 24 · base 28 · lg 32.
Menu rows: height 30, gap 4, radius 12 (rows 6), font 13/18.
Composer: height 44, radius 22, .5px hairline border.
Transcript bubbles: radius 18.
Radii: none 0 · xs 2 · sm 4 · base 6 · lg 8 · xl 12 · 2xl 14 · 3xl 16 · 4xl 18 · full 9999.
Scrollbar: vertical 14, horizontal 12.

## Theme — primitives

Neutral ramps (index 0–6). Light theme surfaces invert the ramp: base text = neutral/5.

| slot | light | dark |
|---|---|---|
| neutral/0 | #ffffff | #1f1f1f |
| neutral/1 | #ffffff | #161616 |
| neutral/2 | #fcfcfc | #121212 |
| neutral/3 | #f5f5f5 | #0e0e0e |
| neutral/4 | #363636 | #dbdbdb |
| neutral/5 | #1c1c1c | #f5f5f5 |
| neutral/6 | #525252 | #c1c1c1 |

Color ramps red/orange/yellow/green/cyan/blue/purple/magenta/brown, 8 steps each (0=bright fill, 1=fill, 2=fillHover, 3=foreground, 4=foregroundHover, 5/6=light tints, 7=fillPressed). Accent = blue ramp. Full ramps in `grok-tokens.json`.

Accent (blue): light `#1e86fc/#1680f3/#126fd4/#0b6dd3/…` · dark `#1884fc/#116dd2/#1784fb/#4d9bff/…`
Brand orange: `#F54E00`. Diff colors: added `#3FA26633/22`, removed `#B8004933/22`.

## Theme — semantic roles

Surface stack (each = neutral slot): pane n/1 · chrome n/2 · sidebar n/3 · elevated n/0 · base(text/ink) n/5 · baseHover n/4 · onPrimary = neutral/1 light, neutral/5 dark · focus = accentFillBright.

Opacity mixes on `base` (same alphas both themes — apply to #1c1c1c light, #f5f5f5 dark):

- text: primary 100% · secondary ad · tertiary 8f · quaternary 66
- icon: primary eb · secondary a8 · tertiary 85 · quaternary 52
- bg: hover 0f · active 14 · secondary 0f · secondary-hover 1a · secondary-disabled 0a · tertiary 0f · quaternary 0a · primary-disabled 26
- border (translucent): primary 3d · secondary 1f · tertiary 14 · quaternary 0f
- scrim: #00000080 · scrim-heavy #000000e5
- user bubble fill: base (light #1c1c1c → white text; dark #f5f5f5 → dark text). Accent-flavored bubble: accentFillHover (light #126fd4) / accentFill (dark #116dd2)
- agent bubble fill: base@0f
- accent bg: primary accentFill · hover accentFillHover · disabled accentFill@2b · secondary accentBright@17, hover @2b, disabled @10

## Shadows (light theme alphas on base)

- control `#1c1c1c1f` · card `#1c1c1c09` · inline ambient `14` / key `0f`
- popover/modal ambient+key `#1c1c1c1a` · window ambient `#1c1c1c8f` / edge `1a` · ring `01`
- Recipes: sm `0 2px 8px shadow-2` · base `0 0 8px 2px shadow-1` · popup `0 3px 8px + 0 2px 5px + 0 1px 1px shadow-2` · lg `inset 0 0 4px #FFFFFF0D + 0 0 3px shadow-2 + 0 16px 24px shadow-3` · xl `inset + 0 0 6px 8px shadow-2 + 0 24px 16px 6px shadow-3`
- shadow-1 = #000@20% · shadow-2 = shadow-1@60% · shadow-3 = shadow-1@30%

## Motion

Durations: instant 50ms · fast .1s · normal .15s · slow .2s · slower .3s.
Easings: default `ease`, out-quint `cubic-bezier(.16,1,.3,1)`, out-cubic `cubic-bezier(.215,.61,.355,1)`, in-out-strong `cubic-bezier(.77,0,.175,1)`, in-strong `cubic-bezier(.895,.03,.685,.22)`, out-strong `cubic-bezier(.165,.84,.44,1)`. Panel ease `cubic-bezier(.23,1,.32,1)`.
`prefers-reduced-motion`: transforms drop to opacity-only.

## Icons

`cursor-icons-16-gwXtdAvu.woff2` — 1,624 named glyphs (PUA `0xea60`+), sized for 16px. Icon component sets `--cursor-icon-content:"<name>"` — ligature lookup does the rest; `variant` = outline (default) or filled (`-filled` suffix, 330); `*-legacy` is the retired set (644 — avoid). RTL-flippable names get mirrored automatically. Sizes follow the xs–2xl icon-size scale; `modifierSpin` animates loaders.

Vocabulary highlights: `arrow-*` family (left/right/up/down, `-right-up`, `arrow-swap`, `arrow-bracket-*`, `arrow-square-*`, `arrow-u-up-*`), `agent`, `agent-circle`, `agent-square`, `agents`, `agents-swarm`, `x`, `x-circle`, `window`, `window-filled`, `window-pointer-arrow`, `workspace-*`, `wrench`, `watch`, `waveform`, `windows`, `yarn`, `warning-*`, `word-wrap`, `whitespace`. Full list: `icons.txt` (1,624 names, sorted).

## How the themes resolve (worked examples)

```
light: pane    = neutral/1 = #ffffff        dark: pane    = neutral/1 = #161616
light: chrome  = neutral/2 = #fcfcfc        dark: chrome  = neutral/2 = #121212
light: sidebar = neutral/3 = #f5f5f5        dark: sidebar = neutral/3 = #0e0e0e
light: elevated= neutral/0 = #ffffff        dark: elevated= neutral/0 = #1f1f1f
light: text/primary   = #1c1c1c             dark: text/primary   = #f5f5f5
light: text/secondary = #1c1c1cad           dark: text/secondary = #f5f5f5ad
light: bg/hover       = #1c1c1c0f           dark: bg/hover       = #f5f5f50f
light: user bubble    = #1c1c1c / #fff text dark: user bubble    = #f5f5f5 / #1c1c1c text
light: accent         = #1680f3             dark: accent         = #1884fc
```
