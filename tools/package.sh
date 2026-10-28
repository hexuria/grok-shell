#!/bin/sh
# Assemble a distributable Grok Shell.app: nsh's packaged runner plus the
# app-server runtime (node + bundled server + nsh binaries for pop-outs).
# Usage: tools/package.sh [out-dir]   (default: ./dist)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
APP="$OUT/Grok Shell.app"
NSH_BIN="${NSH:-$(command -v nsh)}"
NSH_HOST_BIN="${NSH_HOST:-$(command -v nsh-macos-host)}"
[ -n "$NSH_HOST_BIN" ] || NSH_HOST_BIN="$(dirname "$NSH_BIN")/nsh-macos-host"

"$NSH_BIN" package "$ROOT/app" --target macos --icon "$ROOT/app/icon.png" --out "$OUT"

M="$APP/Contents/MacOS"
R="$APP/Contents/Resources"
mv "$M/GrokShell" "$M/GrokShell-bin"

"$ROOT/tools/package-server.sh" "$R"

# nsh + host binaries: pop-outs do `nsh build` → `nsh-macos-host --bundle`.
cp "$NSH_BIN" "$R/server/nsh"
cp "$NSH_HOST_BIN" "$R/server/nsh-macos-host"

cat > "$M/GrokShell" <<'EOF'
#!/bin/sh
# Grok Shell launcher: bring the bundled app-server up, then the runner.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
DATA="$HOME/Library/Application Support/Grok Shell"
mkdir -p "$DATA"
export GROK_DATA_DIR="$DATA"
export GROK_BUNDLE_ID="dev.goldcoders.grokshell"
export NSH="$RES/server/nsh"
export NSH_HOST="$RES/server/nsh-macos-host"
# Runtime-generated modules load through __nsh_import, which the runner's
# load_chunk serves from here (the bundle's Resources are read-only).
export NSH_CHUNK_DIR="$DATA/chunks"
[ -d "$DATA/widgets" ] || cp -R "$RES/server/widgets" "$DATA/widgets"
if ! /usr/bin/curl -fs "http://127.0.0.1:8787/health" >/dev/null 2>&1; then
  "$RES/server/node" "$RES/server/app-server.mjs" \
    >>"$DATA/server.log" 2>&1 &
fi
exec "$(dirname "$0")/GrokShell-bin" "$@"
EOF
chmod +x "$M/GrokShell"

codesign --force --deep --sign - "$APP" >/dev/null
echo "packaged $APP"
