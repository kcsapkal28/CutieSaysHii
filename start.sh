#!/usr/bin/env bash
# One command to run DeckForge: the claude-openai proxy (if it isn't already up) + the Studio.
#   ./start.sh            real pipeline, opens http://localhost:3210
#   ./start.sh --mock     fake timed backend, no proxy, no LLM cost
#   ./start.sh --no-open  don't open the browser
# Ctrl-C stops the Studio and any proxy this script started.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXY_DIR="${CLAUDE_OPENAI_DIR:-$ROOT/../claude-openai}"
PROXY_PORT="${ANTHROPIC_PORT:-4001}"
STUDIO_PORT=3210
LOG_DIR="$ROOT/.logs"

MOCK=0
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --mock) MOCK=1 ;;
    --no-open) OPEN=0 ;;
    -h|--help) sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 1 ;;
  esac
done

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

proxy_up() { curl -fsS -m 2 -o /dev/null "http://localhost:$PROXY_PORT/health" 2>/dev/null; }

PROXY_PID=""
STUDIO_PID=""

kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT
  [[ -n "$STUDIO_PID" ]] && kill_tree "$STUDIO_PID"
  if [[ -n "$PROXY_PID" ]]; then
    say "Stopping proxy"
    kill "$PROXY_PID" 2>/dev/null || true
    (cd "$PROXY_DIR" && bash start.sh -k >/dev/null 2>&1) || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ── Preflight ────────────────────────────────────────────────────────────────
command -v node >/dev/null || die "node not found (Node 24+ required)"
command -v pnpm >/dev/null || die "pnpm not found (npm i -g pnpm, or: corepack enable)"
[[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]] || die "Node 24+ required (found $(node -v))"

cd "$ROOT"
if [[ ! -d node_modules ]]; then
  say "Installing dependencies"
  pnpm install --frozen-lockfile
fi

if ! compgen -G "$HOME/Library/Caches/ms-playwright/chromium-*" >/dev/null && ! compgen -G "$HOME/.cache/ms-playwright/chromium-*" >/dev/null; then
  say "Playwright Chromium not found; installing (needed to screenshot slides)"
  pnpm --filter @deckforge/forge exec playwright install chromium
fi

# ── Proxy ────────────────────────────────────────────────────────────────────
if [[ $MOCK -eq 1 ]]; then
  say "Mock mode: skipping the proxy"
else
  [[ -f .env ]] || die ".env missing. Copy .env.example to .env and set LLM_API_KEY (the proxy's key)."
  grep -Eq '^[[:space:]]*(export[[:space:]]+)?LLM_API_KEY=.+' .env || die "LLM_API_KEY is empty in .env"

  if proxy_up; then
    say "Proxy already running on :$PROXY_PORT (reusing it)"
  else
    [[ -f "$PROXY_DIR/start.sh" ]] || die "claude-openai not found at $PROXY_DIR (set CLAUDE_OPENAI_DIR)"
    say "Starting claude-openai proxy on :$PROXY_PORT (localhost only)"
    mkdir -p "$LOG_DIR"
    # BIND_HOST=127.0.0.1 keeps the proxy off the LAN; its start.sh binds 0.0.0.0 by default.
    # MAX_CONCURRENT (proxy default 5) above the build's 6 slides at once plus the outline's 6 cards.
    (cd "$PROXY_DIR" && BIND_HOST=127.0.0.1 MAX_CONCURRENT="${MAX_CONCURRENT:-12}" exec bash start.sh) >"$LOG_DIR/proxy.log" 2>&1 &
    PROXY_PID=$!
    for _ in $(seq 1 60); do
      proxy_up && break
      kill -0 "$PROXY_PID" 2>/dev/null || die "proxy exited early; see $LOG_DIR/proxy.log"
      sleep 0.5
    done
    proxy_up || die "proxy did not become healthy in 30s; see $LOG_DIR/proxy.log"
  fi
fi

# ── Studio ───────────────────────────────────────────────────────────────────
if lsof -nP -iTCP:$STUDIO_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  die "port $STUDIO_PORT is already in use (is the Studio already running?)"
fi

if [[ $OPEN -eq 1 ]] && command -v open >/dev/null; then
  ( for _ in $(seq 1 120); do
      curl -fsS -m 2 -o /dev/null "http://localhost:$STUDIO_PORT" 2>/dev/null && { open "http://localhost:$STUDIO_PORT"; exit 0; }
      sleep 0.5
    done ) &
fi

say "Studio → http://localhost:$STUDIO_PORT  (Ctrl-C to stop)"
export STUDIO_BACKEND=$([[ $MOCK -eq 1 ]] && echo mock || echo real)
# Backgrounded + waited on so TERM/INT reach the trap at once; cleanup then kills the whole tree.
pnpm --filter studio dev &
STUDIO_PID=$!
wait "$STUDIO_PID"
