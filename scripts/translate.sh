#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: npm run translate -- <inputPath|-> [additional subtitle-translate args]" >&2
  echo "Example: npm run translate -- ./movie.en.srt --to vi --out ./movie.vi.srt" >&2
  exit 1
fi

INPUT_PATH="$1"
shift

MODEL="${MODEL:-qwen3.5:9b}"
THINK="${THINK:-false}"
FAST="${FAST:-false}"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
BATCH_SIZE="${BATCH_SIZE:-2}"
TIMEOUT_MS="${TIMEOUT_MS:-300000}"
MAX_RETRIES="${MAX_RETRIES:-2}"
VERBOSE="${VERBOSE:-0}"

npm run build >/dev/null

EXTRA_FLAGS=()
if [[ "$VERBOSE" == "1" ]]; then
  EXTRA_FLAGS+=("--verbose")
fi
if [[ "$THINK" == "true" ]]; then
  EXTRA_FLAGS+=("--think")
else
  EXTRA_FLAGS+=("--no-think")
fi
if [[ "$FAST" == "true" ]]; then
  EXTRA_FLAGS+=("--fast")
fi

node dist/cli/index.js "$INPUT_PATH" \
  --model "$MODEL" \
  --base-url "$OLLAMA_BASE_URL" \
  --batch-size "$BATCH_SIZE" \
  --timeout-ms "$TIMEOUT_MS" \
  --max-retries "$MAX_RETRIES" \
  "${EXTRA_FLAGS[@]}" \
  "$@"
