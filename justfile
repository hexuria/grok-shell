# Grok Shell — everyday commands. Run `just` (no args) to list them.
#
# Two processes make the app work:
#   app-server (Node, :8787) — agent backend: chats, bots, generated apps, state
#   nsh run — the Native Shell window (dev server + hot reload; Cmd+R reloads)
# `just status` shows who is serving what — vital when several worktrees run.

# $NSH overrides; otherwise `nsh` resolves on PATH (needs the patched fork —
# see README). NSH=<path> just run etc.
nsh := env_var_or_default("NSH", "nsh")

default:
    @just --list

# ── run ──────────────────────────────────────────────────────────────────

# Full app: backend (reuses a live :8787 server) + Native Shell window.
run: server
    {{nsh}} run app --target macos

# Backend only — idempotent: reuses whatever already answers on :8787,
# whichever worktree it belongs to (`just status` shows the owner).
server:
    #!/usr/bin/env bash
    set -euo pipefail
    if curl -sf -o /dev/null http://127.0.0.1:8787/widget-feed; then
      echo "app-server already up on :8787"
      exit 0
    fi
    [ -d node_modules ] || npm install
    ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(secret get ANTHROPIC_API_KEY 2>/dev/null || true)}"
    [ -n "$ANTHROPIC_API_KEY" ] || echo "warning: no ANTHROPIC_API_KEY — bots list but generations will fail"
    export ANTHROPIC_API_KEY NSH={{nsh}}
    nohup node server/app-server.mjs > /tmp/app-server.log 2>&1 &
    for _ in $(seq 1 20); do
      curl -sf -o /dev/null http://127.0.0.1:8787/widget-feed && break
      sleep 0.5
    done
    echo "app-server up on :8787 (log: /tmp/app-server.log)"

# Offline backend — canned widgets, no API key. Restarts :8787 in mock mode.
server-mock:
    #!/usr/bin/env bash
    set -euo pipefail
    lsof -ti :8787 | xargs kill 2>/dev/null || true
    [ -d node_modules ] || npm install
    MOCK=1 nohup node server/app-server.mjs > /tmp/app-server.log 2>&1 &
    echo "mock app-server starting on :8787"

# ── build ────────────────────────────────────────────────────────────────

# Typecheck + compile the app bundle into out/, and the office editor bundle.
# The stub guard covers a fresh clone: generated/ is gitignored, and
# shell.tsx imports its registry — the server writes the real one at boot.
build:
    [ -d node_modules ] || npm install
    [ -f generated/index.tsx ] || { mkdir -p generated; printf 'export const MODULES: Record<string, any> = {};\n' > generated/index.tsx; }
    -{{nsh}} check app
    {{nsh}} build app
    npm run build:office-editor

# ── publish ──────────────────────────────────────────────────────────────

# Installable macOS .app → dist/ (ad-hoc signed, app-server + nsh binaries
# bundled — runs standalone, keeps its data in ~/Library/Application Support).
publish:
    tools/package.sh dist
    @echo "packaged dist/Grok Shell.app — fully standalone"

# Bare nsh package without the bundled server (UI shell only, still needs
# `just server` running for chat + state).
publish-shell: build
    {{nsh}} package app --target macos --icon app/icon.png --out out
    @echo "packaged .app is in out/ — it still needs 'just server' for chat + state."

# Signed .nshpkg for hosts that embed nsh (not a standalone app).
# First run creates keys/ — gitignored, keep the .secret files private.
publish-signed: build
    #!/usr/bin/env bash
    set -euo pipefail
    if [ ! -f keys/release.cert ]; then
      mkdir -p keys
      {{nsh}} keygen keys/root
      {{nsh}} keygen keys/release
      {{nsh}} certify --root keys/root.secret --key keys/release.pub \
        --apps com.example.grok-shell --out keys/release.cert
      echo "created keys/ (gitignored)"
    fi
    {{nsh}} publish app --key keys/release.secret --cert keys/release.cert

# ── housekeeping ─────────────────────────────────────────────────────────

# Which worktree owns :8787, which dev servers and host windows are alive.
status:
    #!/usr/bin/env bash
    for port in 8787 8789; do
      pid=$(lsof -ti :$port -sTCP:LISTEN 2>/dev/null | head -1 || true)
      [ -n "$pid" ] && echo ":$port ← $(ps -p $pid -o comm= | xargs) (pid $pid) cwd=$(lsof -a -p $pid -d cwd -Fn 2>/dev/null | tail -1 | cut -c2-)"
    done
    pgrep -fl "nsh (dev|run)" || echo "no nsh dev servers"
    pgrep -fl "host --dev-server" || echo "no host windows"

# Kill the :8787 backend + every nsh dev server and host window
# (all worktrees — only run when Grok Shell is the only nsh app up).
stop:
    -lsof -ti :8787 | xargs kill
    -pkill -f "nsh dev"
    -pkill -f "nsh run"
    -pkill -f "macos-host"

# Remove regenerable build artifacts. Never touches generated/ — your data.
clean:
    rm -rf out windows .nsh server/.stage server/office/editor/dist

# Lint with oxlint + the vendored anti-slop plugin
lint:
    npx oxlint
