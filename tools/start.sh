#!/bin/bash
# Launches grok-shell end to end: the generation server (Claude via
# `secret`) plus the chat app in a Native Shell host.
#
# Uses the patched nsh checkout by default (Window.setFrame / setLevel —
# our fork of longbridge/nsh, PR #61). Override with NSH=<path>; falls
# back to the installed `nsh` if the checkout isn't built.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# nsh binary: $NSH, else `nsh` on PATH. Pop-outs/typechecks need the patched
# fork (Window.setFrame/setLevel, onContextMenu); point NSH at your build
# (e.g. NSH=<nsh repo>/target/release/nsh) or install it on PATH.
NSH="${NSH:-nsh}"

# Generation server (idempotent: an existing one is reused).
if ! curl -sf -o /dev/null "http://127.0.0.1:8787/widget-feed"; then
  # ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL pass through if the caller exported
  # them (direct-mode escape hatch); the default Claude path is opencodex.
  export NSH
  nohup node "$ROOT/server/app-server.mjs" >/tmp/app-server.log 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null "http://127.0.0.1:8787/widget-feed" && break
    sleep 0.5
  done
fi

exec "$NSH" run "$ROOT/app" --target macos
