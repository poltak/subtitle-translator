#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { stdin as input, stdout as output, stderr } from "node:process";
import { createOllamaAdapter } from "../adapters/llm/ollama.js";
import { detectFormat, parseSubtitle, serializeSubtitle } from "../core/format.js";
import { translateSubtitles } from "../core/translateSubtitles.js";
import type { SubtitleDoc, SubtitleFormat } from "../types.js";
import { writeTextFile } from "../io/nodeFileIO.js";
import { createNodeTransport } from "../runtime/node/transport.js";

interface CliArgs {
  positionalInputPath?: string;
  input?: string;
  output?: string;
  from?: string;
  to?: string;
  model?: string;
  think?: boolean;
  format?: SubtitleFormat;
  baseUrl?: string;
  batchSize?: number;
  timeoutMs?: number;
  maxRetries?: number;
  contextWindow?: number;
  maxCharsPerLine?: number;
  maxLines?: number;
  checkpointPath?: string;
  resume?: boolean;
  verbose?: boolean;
  help?: boolean;
}

interface TranslationCheckpoint {
  version: 1;
  inputHash: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  translatedByIndex: Record<string, string>;
  completedBatches: number;
  totalBatches: number;
  updatedAt: string;
}

async function main(): Promise<void> {
  const args = parseArgs({ argv: process.argv.slice(2) });
  if (args.help) {
    printHelp();
    return;
  }

  const inputSource = args.input ?? args.positionalInputPath;
  if (!inputSource) {
    throw new Error("Missing input. Provide positional <inputPath> or --in <path|->.");
  }

  const inputText =
    inputSource === "-" ? await readAllStdin() : readFileSync(inputSource, "utf8");
  const inputFileName = inputSource === "-" ? undefined : basename(inputSource);
  const inputFormat = args.format ?? detectFormat({ text: inputText, fileName: inputFileName });
  const outputFormat = args.format ?? inputFormat;
  const out = args.output ?? suggestOutputPath({ inputSource, format: outputFormat });
  const checkpointPath = args.checkpointPath ?? (out !== "-" ? `${out}.checkpoint.json` : undefined);

  const inputDoc = parseSubtitle({ text: inputText, format: inputFormat });
  const inputHash = sha256({ value: inputText });
  const sourceLang = args.from ?? "en";
  const targetLang = args.to ?? "vi";
  const model = args.model ?? "qwen3.5:9b";
  const think = args.think ?? false;
  const shouldResume = args.resume ?? true;

  const fromOutput = shouldResume
    ? loadProgressFromOutput({
        outputPath: out,
        outputFormat,
        inputDoc,
        verbose: Boolean(args.verbose),
      })
    : {};

  const checkpoint = shouldResume
    ? loadCheckpoint({
        checkpointPath,
        inputHash,
        sourceLang,
        targetLang,
        model,
        verbose: Boolean(args.verbose),
      })
    : undefined;

  const fromCheckpoint = checkpoint?.translatedByIndex
    ? Object.fromEntries(
        Object.entries(checkpoint.translatedByIndex)
          .map(([key, value]) => [Number(key), value])
          .filter(([key, value]) => Number.isFinite(key) && typeof value === "string"),
      )
    : {};

  const initialTranslatedByIndex = {
    ...fromOutput,
    ...fromCheckpoint,
  };

  const adapter = createOllamaAdapter({
    transport: createNodeTransport(),
    config: {
      provider: "ollama",
      model,
      think,
      baseUrl: args.baseUrl ?? "http://127.0.0.1:11434",
      temperature: 0,
      timeoutMs: args.timeoutMs ?? 300000,
      maxRetries: args.maxRetries ?? 2,
      onDebug: args.verbose ? (message) => stderr.write(`[debug] ${message}\n`) : undefined,
    },
  });

  const result = await translateSubtitles({
    doc: inputDoc,
    llmAdapter: adapter,
    options: {
      sourceLang,
      targetLang,
      model,
      think,
      temperature: 0,
      timeoutMs: args.timeoutMs ?? 300000,
      batchSize: args.batchSize ?? 2,
      contextWindow: args.contextWindow ?? 1,
      maxCharsPerLine: args.maxCharsPerLine ?? 42,
      maxLines: args.maxLines ?? 2,
      onProgress: args.verbose ? (message) => stderr.write(`[progress] ${message}\n`) : undefined,
      initialTranslatedByIndex,
      onBatchCommitted: async (state) => {
        if (out !== "-") {
          const progressDoc = buildProgressDoc({
            sourceDoc: inputDoc,
            translatedByIndex: state.translatedByIndex,
            sourceLang,
            targetLang,
          });
          const progressText = serializeSubtitle({ doc: progressDoc, format: outputFormat });
          await writeTextFile({ path: out, content: progressText });
        }

        if (checkpointPath) {
          const payload: TranslationCheckpoint = {
            version: 1,
            inputHash,
            sourceLang,
            targetLang,
            model,
            translatedByIndex: Object.fromEntries(
              Object.entries(state.translatedByIndex).map(([key, value]) => [String(key), value]),
            ),
            completedBatches: state.completedBatches,
            totalBatches: state.totalBatches,
            updatedAt: new Date().toISOString(),
          };
          await writeTextFile({
            path: checkpointPath,
            content: `${JSON.stringify(payload, null, 2)}\n`,
          });
        }
      },
    },
  });

  const finalOutputText = serializeSubtitle({ doc: result.doc, format: outputFormat });

  if (out === "-") {
    output.write(finalOutputText);
    for (const warning of result.warnings) {
      stderr.write(`[warn] ${warning}\n`);
    }
    return;
  }

  await writeTextFile({ path: out, content: finalOutputText });
  stderr.write(`Wrote translated subtitles to ${out}\n`);
  if (checkpointPath) {
    stderr.write(`Checkpoint file: ${checkpointPath}\n`);
  }
  for (const warning of result.warnings) {
    stderr.write(`[warn] ${warning}\n`);
  }
}

function parseArgs(params: { argv: string[] }): CliArgs {
  const args: CliArgs = {};
  const argv = params.argv;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      if (!args.positionalInputPath) args.positionalInputPath = token;
      continue;
    }

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    switch (token) {
      case "--verbose":
        args.verbose = true;
        break;
      case "--resume":
        args.resume = true;
        break;
      case "--no-resume":
        args.resume = false;
        break;
      case "--in":
        args.input = requireValue({ argv, index: i, token });
        i += 1;
        break;
      case "--out":
        args.output = requireValue({ argv, index: i, token });
        i += 1;
        break;
      case "--from":
        args.from = requireValue({ argv, index: i, token });
        i += 1;
        break;
      case "--to":
        args.to = requireValue({ argv, index: i, token });
        i += 1;
        break;
      case "--model":
        args.model = requireValue({ argv, index: i, token });
        i += 1;
        break;
      case "--think":
        args.think = true;
        break;
      case "--no-think":
        args.think = false;
        break;
      case "--format":
        args.format = parseFormat({ value: requireValue({ argv, index: i, token }) });
        i += 1;
        break;
      case "--base-url":
        args.baseUrl = requireValue({ argv, index: i, token });
        i += 1;
        break;
      case "--batch-size":
        args.batchSize = parsePositiveInt({ value: requireValue({ argv, index: i, token }), token });
        i += 1;
        break;
      case "--timeout-ms":
        args.timeoutMs = parsePositiveInt({ value: requireValue({ argv, index: i, token }), token });
        i += 1;
        break;
      case "--max-retries":
        args.maxRetries = parseNonNegativeInt({ value: requireValue({ argv, index: i, token }), token });
        i += 1;
        break;
      case "--context-window":
        args.contextWindow = parseNonNegativeInt({ value: requireValue({ argv, index: i, token }), token });
        i += 1;
        break;
      case "--max-chars-per-line":
        args.maxCharsPerLine = parsePositiveInt({ value: requireValue({ argv, index: i, token }), token });
        i += 1;
        break;
      case "--max-lines":
        args.maxLines = parsePositiveInt({ value: requireValue({ argv, index: i, token }), token });
        i += 1;
        break;
      case "--checkpoint-path":
        args.checkpointPath = requireValue({ argv, index: i, token });
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function parseFormat(params: { value: string }): SubtitleFormat {
  if (params.value === "srt" || params.value === "vtt" || params.value === "json") {
    return params.value;
  }
  throw new Error(`Invalid --format value: ${params.value}`);
}

function requireValue(params: { argv: string[]; index: number; token: string }): string {
  const value = params.argv[params.index + 1];
  if (value === undefined) {
    throw new Error(`Missing value for ${params.token}`);
  }
  return value;
}

function parsePositiveInt(params: { value: string; token: string }): number {
  const parsed = Number(params.value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${params.token}: expected positive integer, got "${params.value}"`);
  }
  return parsed;
}

function parseNonNegativeInt(params: { value: string; token: string }): number {
  const parsed = Number(params.value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${params.token}: expected non-negative integer, got "${params.value}"`);
  }
  return parsed;
}

function suggestOutputPath(params: { inputSource: string; format: SubtitleFormat }): string {
  if (params.inputSource === "-") return "-";

  const extension = extname(params.inputSource);
  const base = extension ? params.inputSource.slice(0, -extension.length) : params.inputSource;
  return `${base}.translated.${params.format}`;
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    input.setEncoding("utf8");
    let data = "";
    input.on("data", (chunk) => {
      data += chunk;
    });
    input.on("end", () => resolve(data));
    input.on("error", reject);
  });
}

function printHelp(): void {
  output.write(`subtitle-translate

Usage:
  subtitle-translate <inputPath> [options]
  subtitle-translate --in - [options]

Options:
  --in <path|->        Input file path or - for stdin
  --out <path|->       Output file path or - for stdout
  --from <lang>        Source language (default: en)
  --to <lang>          Target language (default: vi)
  --model <modelId>    Ollama model (default: qwen3.5:9b)
  --think              Enable model reasoning when supported
  --no-think           Disable model reasoning (default)
  --format <srt|vtt|json>  Explicit input/output format
  --base-url <url>     Ollama base URL (default: http://127.0.0.1:11434)
  --batch-size <n>     Batch size per LLM call (default: 2)
  --timeout-ms <ms>    Request timeout per batch (default: 300000)
  --max-retries <n>    Retries per batch request (default: 2)
  --context-window <n> Context items on each side (default: 1)
  --max-chars-per-line <n>  Line reflow character limit (default: 42)
  --max-lines <n>      Max lines per subtitle block (default: 2)
  --checkpoint-path <path>  Optional sidecar checkpoint metadata file
  --resume             Resume using output file/checkpoint when available (default: on)
  --no-resume          Ignore output/checkpoint progress and start fresh
  --verbose            Print progress/debug logs to stderr
  --help               Show this help
`);
}

main().catch((error: unknown) => {
  stderr.write(`${formatCliError({ error })}\n`);
  process.exitCode = 1;
});

function formatCliError(params: { error: unknown }): string {
  const asText = params.error instanceof Error ? `${params.error.name}: ${params.error.message}` : String(params.error);
  const lower = asText.toLowerCase();
  if (lower.includes("aborterror") || lower.includes("operation was aborted")) {
    return [
      `Error: ${asText}`,
      "Hint: request timed out while waiting for Ollama.",
      "Try: increase --timeout-ms (e.g. 900000), reduce --batch-size (e.g. 3-8), and use --verbose for progress logs.",
      "Also verify Ollama is responsive: curl http://127.0.0.1:11434/api/tags",
    ].join("\n");
  }
  return `Error: ${asText}`;
}

function sha256(params: { value: string }): string {
  return createHash("sha256").update(params.value).digest("hex");
}

function buildProgressDoc(params: {
  sourceDoc: SubtitleDoc;
  translatedByIndex: Record<number, string>;
  sourceLang: string;
  targetLang: string;
}): SubtitleDoc {
  return {
    ...params.sourceDoc,
    sourceLanguage: params.sourceLang,
    targetLanguage: params.targetLang,
    items: params.sourceDoc.items.map((item) => {
      const translated = params.translatedByIndex[item.index];
      if (!translated) return item;
      return {
        ...item,
        text: translated,
        lines: translated.split("\n"),
      };
    }),
  };
}

function loadProgressFromOutput(params: {
  outputPath: string;
  outputFormat: SubtitleFormat;
  inputDoc: SubtitleDoc;
  verbose: boolean;
}): Record<number, string> {
  if (params.outputPath === "-") return {};
  if (!existsSync(params.outputPath)) return {};

  try {
    const outputText = readFileSync(params.outputPath, "utf8");
    const outputDoc = parseSubtitle({ text: outputText, format: params.outputFormat });

    if (!sameStructure({ a: params.inputDoc, b: outputDoc })) {
      if (params.verbose) {
        stderr.write(`[debug] Ignoring output progress due to structure mismatch: ${params.outputPath}\n`);
      }
      return {};
    }

    const translatedByIndex: Record<number, string> = {};
    for (let i = 0; i < params.inputDoc.items.length; i += 1) {
      const src = params.inputDoc.items[i];
      const out = outputDoc.items[i];
      const srcText = src.text.trim();
      const outText = out.text.trim();
      if (!outText) continue;
      if (!srcText) {
        translatedByIndex[src.index] = out.text;
        continue;
      }

      // Best-effort resume signal: output text differs from source text.
      if (outText !== srcText) {
        translatedByIndex[src.index] = out.text;
      }
    }

    if (params.verbose) {
      stderr.write(
        `[debug] Loaded progress from output ${params.outputPath} (${Object.keys(translatedByIndex).length} translated cues)\n`,
      );
    }
    return translatedByIndex;
  } catch (error) {
    if (params.verbose) {
      stderr.write(`[debug] Failed to read output progress ${params.outputPath}: ${String(error)}\n`);
    }
    return {};
  }
}

function sameStructure(params: { a: SubtitleDoc; b: SubtitleDoc }): boolean {
  if (params.a.items.length !== params.b.items.length) return false;
  for (let i = 0; i < params.a.items.length; i += 1) {
    const left = params.a.items[i];
    const right = params.b.items[i];
    if (
      left.index !== right.index ||
      left.startMs !== right.startMs ||
      left.endMs !== right.endMs
    ) {
      return false;
    }
  }
  return true;
}

function loadCheckpoint(params: {
  checkpointPath?: string;
  inputHash: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  verbose: boolean;
}): TranslationCheckpoint | undefined {
  if (!params.checkpointPath) return undefined;
  if (!existsSync(params.checkpointPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(params.checkpointPath, "utf8")) as TranslationCheckpoint;
    if (
      parsed?.inputHash !== params.inputHash ||
      parsed?.sourceLang !== params.sourceLang ||
      parsed?.targetLang !== params.targetLang ||
      parsed?.model !== params.model
    ) {
      if (params.verbose) {
        stderr.write(
          `[debug] Ignoring checkpoint due to mismatch: ${params.checkpointPath}\n`,
        );
      }
      return undefined;
    }
    if (params.verbose) {
      stderr.write(
        `[debug] Loaded checkpoint ${params.checkpointPath} (${Object.keys(parsed.translatedByIndex ?? {}).length} translated cues)\n`,
      );
    }
    return parsed;
  } catch (error) {
    if (params.verbose) {
      stderr.write(
        `[debug] Failed to read checkpoint ${params.checkpointPath}: ${String(error)}\n`,
      );
    }
    return undefined;
  }
}
