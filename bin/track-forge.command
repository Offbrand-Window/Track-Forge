#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE_PORT="${PORT:-5173}"
if [[ "$(uname -s)" == "Darwin" ]]; then
  LOG_DIR="${HOME}/Library/Application Support/Track Forge"
else
  LOG_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/Track Forge"
fi
LOG_FILE="${LOG_DIR}/track-forge.log"
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  RUNTIME_ARCH="arm64"
else
  RUNTIME_ARCH="x64"
fi

EMBEDDED_NODE="${APP_DIR}/runtime/node/${RUNTIME_ARCH}/bin/node"
EMBEDDED_FFMPEG="${APP_DIR}/runtime/ffmpeg/${RUNTIME_ARCH}/ffmpeg"
EMBEDDED_YTDLP="${APP_DIR}/runtime/ytdlp/yt-dlp_macos"

mkdir -p "$LOG_DIR"

PORT=""
for candidate in $(seq "$BASE_PORT" "$((BASE_PORT + 20))"); do
  candidate_url="http://localhost:${candidate}"
  if curl -fsS "${candidate_url}/api/health" 2>/dev/null | grep -q '"app":"Track Forge"'; then
    PORT="$candidate"
    break
  fi
  if ! curl -fsS "$candidate_url" >/dev/null 2>&1; then
    PORT="$candidate"
    break
  fi
done

if [[ -z "$PORT" ]]; then
  osascript -e 'display dialog "Track Forge could not find an available local port between 5173 and 5193." buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

URL="http://localhost:${PORT}"

if [[ -x "$EMBEDDED_NODE" ]]; then
  NODE_BIN="${NODE_BIN:-$EMBEDDED_NODE}"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="${NODE_BIN:-$(command -v node)}"
else
  osascript -e 'display dialog "Track Forge could not find its embedded Node runtime. Reinstall the app bundle or install Node.js." buttons {"OK"} default button "OK" with icon caution'
  exit 1
fi

if ! curl -fsS "${URL}/api/health" 2>/dev/null | grep -q '"app":"Track Forge"'; then
  export PORT
  export YTDLP_NO_CHECK_CERTIFICATE="${YTDLP_NO_CHECK_CERTIFICATE:-1}"
  if [[ -x "$EMBEDDED_FFMPEG" ]]; then
    export FFMPEG_PATH="${FFMPEG_PATH:-$EMBEDDED_FFMPEG}"
  fi
  if [[ -x "$EMBEDDED_YTDLP" ]]; then
    export YTDLP_PATH="${YTDLP_PATH:-$EMBEDDED_YTDLP}"
  fi
  export PATH="$(dirname "$NODE_BIN"):${APP_DIR}/node_modules/.bin:${PATH:-}"
  nohup "$NODE_BIN" "$APP_DIR/server.js" >>"$LOG_FILE" 2>&1 &
  sleep 2
fi

open "$URL"
