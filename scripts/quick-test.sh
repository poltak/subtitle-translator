#!/usr/bin/env bash
set -euo pipefail

npm run build
node dist/cli/index.js fixtures/sample.en.srt --to vi --out fixtures/sample.vi.srt --model qwen3.5:9b --base-url http://127.0.0.1:11434

echo "\nTranslated output:"
cat fixtures/sample.vi.srt
