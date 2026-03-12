Subtitle Translation Module Spec Build a standalone local module that translates
subtitle files from one language to another while preserving subtitle timing and
structure. This spec is written for implementation by Codex in a
TypeScript/Node.js codebase on macOS, with local models only.

1. Goal Implement a module:

```
Plain text
```

that:

accepts an input subtitle file or subtitle JSON

translates subtitle text from sourceLang to targetLang

preserves subtitle timing

preserves subtitle ordering

preserves block count by default

preserves indices by default

reflows lines within each subtitle block for readability in the target language

outputs a valid translated subtitle file and/or subtitle JSON

This module must work independently of any transcription pipeline. Examples:

movie.en.srt -> movie.vi.srt

movie.id.vtt -> movie.en.vtt

subtitles.json -> translated-subtitles.json

2. Non-goals Do not make this module responsible for:

transcription from audio/video

extracting subtitles from video containers

OCR from burned-in subtitles

subtitle timing generation

forced alignment

advanced subtitle editing beyond translation and line reflow

merging or splitting subtitle blocks unless explicitly enabled in a later
version

Version 1 should translate existing subtitle blocks, not redesign the subtitle
timeline.

3. High-level behavior Default behavior For each subtitle block:

keep the same start time

keep the same end time

keep the same index

translate only the text payload

reflow line breaks inside the block

keep output ordering identical to input ordering

Output guarantee The output should preserve:

number of subtitle blocks

timestamps

block ordering

semantic correspondence between input block N and output block N

Allowed transformation The translator may:

rewrite punctuation

adapt phrasing naturally into target language

reflow line breaks

normalize whitespace

preserve or transliterate names depending on target language norms

The translator must not:

invent new dialogue

merge multiple blocks into one

split one block into multiple blocks

delete content unless explicitly configured to allow omission of filler words

add commentary, notes, metadata, or explanations

4. Input formats Supported in v1

.srt

.vtt

internal subtitle JSON

Optional later

.ass

.ssa

5. Output formats Supported in v1

.srt

.vtt

internal subtitle JSON

The output format should default to the same format as the input unless
explicitly overridden.

6. Canonical internal model All inputs should be parsed into a canonical
   internal model before translation.

```
TypeScript
```

Model rules

startMs and endMs are integer milliseconds

text is the semantic text for the block

lines is optional and represents display line layout

if lines exists, text should equal lines.join("\\n") after normalization

index should remain stable through translation

7. CLI contract Implement a CLI command:

```
Bash
```

Required args

inputPath

Optional args

--in <path|-> # "-" means read subtitle text from stdin

--from <sourceLang>

--to <targetLang>

--out <outputPath>

--out - # "-" means write translated subtitle to stdout

--format <srt|vtt|json>

--model <modelId>

--batch-size <n>

--max-chars-per-line <n>

--max-lines <n>

--preserve-line-breaks <true|false>

--context-window <n>

--dry-run

--json-report <path>

--overwrite

--verbose

Default language behavior (v1)

if `--from` is omitted, default `sourceLang = en`

if `--to` is omitted, default `targetLang = vi`

both remain fully configurable via CLI or programmatic API

Unix pipe behavior (v1)

`--in -` reads full subtitle text from stdin

`--out -` writes translated subtitle to stdout

reports/logs go to stderr when stdout is used for subtitle payload

Example

```
Bash
```

Example with explicit model

```
Bash
```

8. Programmatic API

```
TypeScript
```

Main entrypoint

```
TypeScript
```

8.1 Runtime target: browser-first, Node-compatible The core translation engine
must run in both browser and Node runtimes.

Browser-first requirements

core modules must avoid Node-only APIs (`fs`, `path`, `process`, `Buffer` as
required runtime dependency)

use web-standard primitives where possible (`fetch`, `TextEncoder`,
`AbortController`)

file parsing/serialization must accept plain strings/objects so browser UIs can
provide file content directly

Node compatibility requirements

Node CLI is a wrapper layer that handles filesystem and argument parsing, then
calls the same core functions used by browser

Node-specific logic must remain in adapter/wrapper files

Runtime abstraction interfaces Add explicit interfaces so platform-specific code
is isolated:

```TypeScript
interface SubtitleSource {
  readText(params: { input: unknown }): Promise<string>;
}

interface SubtitleSink {
  writeText(params: { output: unknown; content: string }): Promise<void>;
}

interface HttpTransport {
  request(params: {
    url: string;
    method: "POST" | "GET";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  }): Promise<{ status: number; bodyText: string }>;
}
```

Implementation note In browser, `SubtitleSource`/`SubtitleSink` can use `File`,
`Blob`, and download APIs. In Node CLI, they map to `fs` reads/writes.
`LlmAdapter` should depend on `HttpTransport`, not directly on Node libraries.

9. Processing pipeline Step 1: parse input

detect input format

parse into SubtitleDoc

validate basic structure

Step 2: normalize

normalize whitespace

normalize newline handling

ensure text and lines are consistent

sort by index or original order if needed

Step 3: determine language metadata

use --from if provided

else use doc.language or doc.sourceLanguage if present

else optionally run language detection on a sample of subtitle text

fail or warn if source language is uncertain

Step 4: batching

group subtitle items into batches for model translation

include neighboring context for each batch

preserve per-item identity

Step 5: translation

send structured prompt to local model

translate each subtitle block

require structured JSON output

do not allow freeform prose output

Step 6: post-process

map translated text back to original blocks

reflow lines

preserve timing and indices

normalize punctuation/whitespace

Step 7: validate

block count must match input unless explicitly allowed otherwise

timestamps must match input exactly

no empty translated text unless source was empty

line count and line length constraints checked

output format serialization checked

Step 8: write output

serialize to target format

emit report

10. Translation strategy Core principle Translate block text, not raw file
    content. Why Because raw subtitle files contain structure that must not be
    damaged:

indices

timestamps

cue separators

note syntax

formatting markers

The model should only operate on structured text payloads.

11. Batch design Do not send one subtitle block at a time unless necessary.
    Single-block translation loses context and causes dumb pronoun mistakes.
    Instead, use batch translation with local neighborhood context. Suggested
    batching

batch 20 to 80 subtitle blocks at a time

include optional context window of 1 to 3 subtitle blocks on each side

translate only target blocks in the batch

keep mapping IDs stable

Batch item shape

```
TypeScript
```

Batch payload shape sent to model

```
JSON
```

Expected model output shape

```
JSON
```

Never trust position alone. Always map by index.

12. Prompt contract for local LLM The translation module should use a strict
    prompt that frames the model as a subtitle translator, not a creative
    rewriter. System prompt

```
Plain text
```

User prompt template

```
Plain text
```

Important implementation note The code should parse model output as JSON. If
parsing fails:

retry with stricter repair prompt

or fall back to smaller batches

or mark items as failed

13. Line reflow behavior After translation, line wrapping should be recomputed
    unless preserveLineBreaks=true. Default

ignore original internal newline positions

recompute line breaks based on target language text

Why Directly preserving original line breaks often produces ugly output because
languages expand and compress differently. Reflow inputs

translated text

max chars per line

max lines

optional punctuation-aware wrapping rules

Default constraints Reasonable v1 defaults:

maxLines = 2

maxCharsPerLine = 42

These should be configurable. Reflow behavior

prefer breaks at spaces/punctuation

avoid single short orphan words when possible

avoid breaking inside numbers, names, abbreviations

if text cannot fit cleanly, still preserve the block and flag a warning

14. Timing preservation rules The translation module must preserve:

startMs

endMs

exactly. No retiming in v1 Do not change subtitle durations even if translated
text becomes longer. Instead:

reflow lines as best as possible

emit warnings when translated text likely exceeds comfortable reading speed

This keeps the module cleanly scoped.

15. Validation rules Structural validation

item count must equal input count

indices must match input

timestamps must match input

no duplicate indices

no missing translated items

Text validation

translated text must be non-empty if source text is non-empty

translated text must not contain obvious prompt leakage like:

"Here is the translation:"

code fences

JSON fragments inside translated text

translated text must not include neighboring subtitle text

Layout validation

line count <= configured max unless warning emitted

line length <= configured max unless warning emitted

Optional heuristic warnings

output text identical to source text for too many blocks

suspiciously long text expansion

untranslated fragments when target language differs strongly from source

model output language mismatch

16. Error handling Fail-fast errors These should abort the operation:

unsupported input format

parse failure

missing target language

invalid output path unless overwrite enabled

model unavailable

unrecoverable malformed model output after retries

Recoverable per-block failures These should not necessarily abort the entire
run:

translation failure for one batch

invalid JSON for one batch after partial recovery

empty translation for one item

For recoverable failures:

keep original source text for failed items if configured

add warning flags

include in report

Suggested option

```
TypeScript
```

Default:

```
TypeScript
```

That makes the tool more usable.

17. Retries and recovery When model output is malformed: Retry strategy

retry same batch once with stricter JSON-only reminder

retry with smaller batch size

if still failing, process items one-by-one

if still failing, apply fallback policy

JSON repair mode Optionally implement a small output repair stage:

strip code fences

trim preamble/postamble

locate first valid JSON object

parse safely

Do not overdo this. If the model is vomiting sludge, fail clearly.

18. Language detection Optional in v1 If sourceLang is not provided:

sample first N non-empty subtitle blocks

run a lightweight language detection step

Preferred behavior

allow explicit --from to override everything

store detected language in report

emit warning if confidence is low

This detection can be heuristic or model-based, but should remain optional.

19. Special subtitle content handling Speaker labels Input like:

```
Plain text
```

should usually remain:

```
Plain text
```

Do not strip speaker labels automatically. Musical cues / SFX Input like:

```
Plain text
```

Configurable behavior:

default: translate them if they are linguistic

preserve bracket/parenthesis style where possible

Example:

```
Plain text
```

HTML or WebVTT tags If tags are supported in input:

preserve tags

translate only human-readable text nodes

Example:

```
Plain text
```

should become:

```
Plain text
```

This requires tag-aware parsing, not raw-string translation. Empty or
whitespace-only cues Preserve as empty unless format rules require omission.

20. v1 simplifications To keep Codex focused, v1 should intentionally simplify:

no block splitting/merging

no retiming

no ASS styling semantics beyond pass-through if format support added later

no speaker diarization logic

no scene-level memory beyond local batch context

no glossary or terminology memory yet

no bilingual subtitle generation yet

21. Suggested file/module structure

```
Plain text
```

Inside subtitle-translate/

```
Plain text
```

Responsibilities

translateSubtitles.ts: orchestration

batching.ts: batch creation and mapping

prompt.ts: prompt builders and schema expectations

postprocess.ts: normalize model output and map back

reflow.ts: subtitle line wrapping

languageDetection.ts: optional source language detection

errors.ts: typed errors

types.ts: module-specific types

runtime/

httpTransport.ts: runtime-agnostic transport interface + helpers

nodeTransport.ts: Node implementation for CLI/runtime scripts

browserTransport.ts: browser implementation using global fetch

io/

source.ts: SubtitleSource interface + shared helpers

sink.ts: SubtitleSink interface + shared helpers

nodeFileIO.ts: Node fs-backed source/sink

browserFileIO.ts: browser File/Blob-backed source/sink

22. LLM adapter abstraction Do not hardcode one local model runtime into core
    translation logic. Create an adapter interface:

```
TypeScript
```

This allows later support for:

Ollama

LM Studio local server

llama.cpp server

MLX-hosted local endpoint

custom local HTTP runner

The translation module should depend on the adapter, not the runtime.

23. Serialization behavior SRT output

preserve numeric indices

format timestamps as HH:MM:SS,mmm

separate blocks by blank line

VTT output

include WEBVTT header

format timestamps as HH:MM:SS.mmm

preserve cue order

preserve supported cue metadata if parsed

JSON output

output canonical SubtitleDoc

24. Example transformation Input SRT

```
srt
```

Parsed internal JSON

```
JSON
```

Translated JSON

```
JSON
```

Output SRT

```
srt
```

25. Acceptance criteria The module is done for v1 when all of the following are
    true:

It can parse .srt and .vtt into canonical subtitle JSON.

It can translate subtitle text with a pluggable local LLM adapter.

It preserves block count, indices, and timestamps exactly.

It can reflow translated lines according to configurable limits.

It can serialize output back to .srt, .vtt, or JSON.

It emits a machine-readable translation report.

It handles malformed model output with retries and fallback behavior.

It can run as both CLI and programmatic API.

It does not require any audio/video input.

It works on an existing subtitle file without any upstream pipeline.

26. Test plan Unit tests

parse SRT

parse VTT

serialize SRT

serialize VTT

line reflow rules

timestamp preservation

batch mapping by index

JSON repair for model output

fallback behavior

Integration tests

translate small .srt from English to Vietnamese

translate .vtt while preserving header and timings

malformed model output recovery

missing one translated item in a batch should trigger warning/failure

translation with explicit --from and --to

Golden tests Keep fixture-based tests:

```
Plain text
```

Golden tests are huge here because subtitle formatting is fragile and annoying.

27. Recommended implementation order

subtitle-model

subtitle-format

reflow

llm-adapter

subtitle-translate

subtitle-validate

CLI wiring

This keeps the foundation clean.

28. Nice-to-have later Not for v1, but good roadmap items:

terminology glossary

translation memory

bilingual subtitle output

profanity/tone controls

domain presets: anime / film / documentary / casual speech

block merge/split mode

CPS-aware shortening suggestions

batch caching

deterministic retranslation for selected ranges only

29. Final implementation note for Codex Prefer a design where:

parsing/serialization is pure and deterministic

translation is isolated behind an adapter

subtitle structure is never directly exposed to raw model output

model output is always validated before being merged into the document

That avoids the classic nightmare where one weird LLM response nukes the whole
subtitle file. If you want, next I can write the TypeScript interfaces +
function skeletons for this spec so you can hand Codex something even more
code-shaped.

30. 2026-03-12 addendum: Ollama-first provider setup Keep the module provider
    agnostic, but make Ollama the default runtime in v1.

Provider policy

default provider: Ollama

provider must be injectable via config/CLI

core translation pipeline must not import provider-specific SDKs directly

all model calls go through one LLM adapter boundary

Suggested config shape

```TypeScript
type LlmProviderType = "ollama";

interface LlmProviderConfig {
  provider: LlmProviderType; // default: "ollama"
  model?: string; // default: "qwen3.5:9b"
  baseUrl?: string; // default for ollama: "http://127.0.0.1:11434"
  temperature?: number; // default: 0
  timeoutMs?: number; // default: 120000
  maxRetries?: number; // default: 2
}
```

CLI additions/clarifications

```bash
--provider <ollama>                     # default: ollama
--base-url <url>                        # optional; uses provider default
```

Adapter contract note The adapter interface should stay minimal and
provider-neutral. Keep one method for "translate batch with strict JSON output"
and keep retry/repair orchestration in core logic, not in provider adapters.

Ollama adapter requirements (v1 only provider implementation)

use Ollama chat/generate HTTP API through `baseUrl`

support local hosted models (for example: qwen3, qwen2.5, llama3.1, mistral)

enforce JSON-only output contract at prompt and parsing layer

return normalized result shape consumed by core pipeline

Browser connectivity note (important)

direct browser -> local Ollama may hit CORS/network constraints depending on
Ollama host settings

v1 browser strategy: support direct calls when available; otherwise use a thin
local bridge endpoint with permissive CORS

this does not change translation core logic because transport is abstracted

JSON mode tradeoff note

prefer Ollama JSON mode when available for stronger structure guarantees

still keep prompt+parser validation in core as a fallback for portability and
model quirks

this hybrid approach gives better reliability now without coupling the pipeline
to one response format feature

Future provider expansion (post-v1)

OpenAI-compatible support can be added later behind the same `LlmAdapter`
contract with no pipeline changes

Model selection guidance for local default

default to a small/medium local model that is good at instruction following and
translation stability

prefer deterministic settings (`temperature: 0`)

default model: `qwen3.5:9b` (configurable via `--model`)

Acceptance criteria update

module runs out of the box with local Ollama using default model `qwen3.5:9b`
unless overridden

no provider-specific logic leaks into parsing, batching, validation, or
serialization modules

core translation functions are reusable in browser and Node without code forks

31. npm package and distribution strategy Publish as one npm package that works
    in both browser and Node.

Package goals

single package name for both runtimes

typed public API for browser and Node consumers

bundled CLI binary for shell usage

no duplicated translation logic between CLI and library

Recommended package layout

```text
src/
  core/                     # runtime-agnostic translation pipeline
  adapters/
    llm/
      ollama.ts
  runtime/
    browser/
    node/
  cli/
    index.ts
```

Recommended package.json surface

```json
{
    "name": "subtitle-translate",
    "type": "module",
    "main": "./dist/node/index.js",
    "module": "./dist/node/index.js",
    "types": "./dist/types/index.d.ts",
    "bin": {
        "subtitle-translate": "./dist/cli/index.js"
    },
    "exports": {
        ".": {
            "types": "./dist/types/index.d.ts",
            "browser": "./dist/browser/index.js",
            "default": "./dist/node/index.js"
        },
        "./browser": {
            "types": "./dist/types/browser.d.ts",
            "default": "./dist/browser/index.js"
        },
        "./node": {
            "types": "./dist/types/node.d.ts",
            "default": "./dist/node/index.js"
        },
        "./cli": "./dist/cli/index.js"
    }
}
```

Build output expectations

browser build must exclude Node-only modules

Node build may include CLI helpers and fs-backed IO adapters

declaration files must ship for all exported entrypoints

Usage targets

Node app imports package API directly

browser app imports browser entrypoint and passes `File`/string input

CLI supports local files and Unix pipes for scripting

Acceptance criteria update

package can be installed via npm and used in Node via imports

package can be used in browser bundlers via browser export

CLI is invokable via `npx subtitle-translate ...`

CLI supports stdin/stdout piping via `--in -` and `--out -`

---
