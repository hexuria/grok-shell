#!/bin/bash
# Launches gen-ui-chat end to end: the generation server (Claude via
# `secret`) plus the chat app in a Native Shell host.
#
# Uses the patched nsh checkout by default (Window.setFrame / setLevel —
# our fork of longbridge/nsh, PR #61). Override with NSH=<path>; falls
# back to the installed `nsh` if the checkout isn't built.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Release first: the debug host is several times slower on the UI thread
# (objc2 checks every message's signature in debug builds).
NSH_REPO=/Volumes/goldcoders/Projects/nsh
NSH="${NSH:-$NSH_REPO/target/release/nsh}"
[ -x "$NSH" ] || NSH="$NSH_REPO/target/debug/nsh"
[ -x "$NSH" ] || NSH=nsh

# Generation server (idempotent: an existing one is reused).
if ! curl -sf -o /dev/null "http://127.0.0.1:8787/widget-feed"; then
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(secret get ANTHROPIC_API_KEY)}"
  export ANTHROPIC_API_KEY NSH
  nohup node "$ROOT/tools/gen-server.mjs" >/tmp/gen-server.log 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null "http://127.0.0.1:8787/widget-feed" && break
    sleep 0.5
  done
fi

exec "$NSH" run "$ROOT/App.tsx" --target macos
