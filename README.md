# subtitle-converter

Ollama-first subtitle translation in TypeScript.

Current focus:
- translate existing `.srt` / `.vtt` subtitle files
- run locally against Ollama-hosted models
- write progress to the output file as batches complete
- resume interrupted runs from the output file and checkpoint sidecar

The implementation is browser-aware, but the main usable path today is the Node CLI.

## Requirements

- Node.js 20+
- Ollama running locally
- a model pulled in Ollama, for example `qwen3.5:9b`

## Install

```bash
npm install
```

## Basic usage

Translate English subtitles to Vietnamese:

```bash
npm run translate -- ./movie.en.srt --from en --to vi --out ./movie.vi.srt
```

Use a specific Ollama model:

```bash
MODEL=qwen3.5:9b npm run translate -- ./movie.en.srt --from en --to vi --out ./movie.vi.srt
```

Use fast mode:

```bash
MODEL=qwen3.5:9b THINK=true FAST=true npm run translate -- ./movie.en.srt --from en --to vi --out ./movie.vi.srt
```

Translate Vietnamese back to English:

```bash
npm run translate -- ./movie.vi.srt --from vi --to en --out ./movie.en.srt
```

## Wrapper env vars

The `npm run translate` wrapper accepts these environment variables:

- `MODEL`
- `THINK=true|false`
- `FAST=true|false`
- `BATCH_SIZE`
- `TIMEOUT_MS`
- `MAX_RETRIES`
- `VERBOSE=1`
- `OLLAMA_BASE_URL`

Example:

```bash
MODEL=qwen3.5:9b THINK=false FAST=true VERBOSE=1 TIMEOUT_MS=60000 npm run translate -- ./movie.en.srt --from en --to vi --out ./movie.vi.srt
```

## What fast mode does

`--fast` is meant for translation throughput and structured-output reliability.

It currently:
- uses single-cue batches by default
- keeps a small local context window around the cue
- uses a stricter, more direct translation prompt
- does not change your `think` setting by itself

You can still override `--batch-size` and `--context-window` manually.

## Resume and progress

The CLI processes subtitle batches sequentially.

As each batch completes, it:
- writes the current translated state to the output subtitle file
- writes a sidecar checkpoint file at `<output>.checkpoint.json`

If the run is interrupted, rerunning the same command will resume from existing output/checkpoint state when possible.

Useful flags:

```bash
--resume
--no-resume
--checkpoint-path /path/to/custom.checkpoint.json
```

## CLI flags

Common flags:

```bash
--from <lang>
--to <lang>
--out <path|-> 
--model <modelId>
--think
--no-think
--fast
--batch-size <n>
--context-window <n>
--timeout-ms <ms>
--max-retries <n>
--verbose
```

You can also pipe input/output:

```bash
cat ./movie.en.srt | npm run translate -- --in - --from en --to vi --out -
```

## Reliability notes

Small models often translate acceptably but are less reliable at returning strict JSON. The adapter currently tries to recover by:

- repairing obvious malformed JSON locally
- asking the model to correct malformed JSON once
- falling back to smaller batches
- preserving source text for single-cue failures instead of aborting the whole run

For better stability, prefer:
- `qwen3.5:9b` or stronger
- `FAST=true`
- `BATCH_SIZE=1`

## Development

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Quick local smoke test:

```bash
npm run quick-test
```

## Status

This is still a focused local tool, not a polished general-purpose package yet. The translation CLI is the main maintained path right now.
