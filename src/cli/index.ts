#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { stdin as input, stdout as output, stderr } from "node:process";
import { createOllamaAdapter } from "../adapters/llm/ollama.js";
import { translateSubtitleText } from "../core/translateText.js";
import type { SubtitleFormat } from "../types.js";
import { writeTextFile } from "../io/nodeFileIO.js";
import { createNodeTransport } from "../runtime/node/transport.js";

interface CliArgs {
  positionalInputPath?: string;
  input?: string;
  output?: string;
  from?: string;
  to?: string;
  model?: string;
  format?: SubtitleFormat;
  baseUrl?: string;
  batchSize?: number;
  timeoutMs?: number;
  maxRetries?: number;
  contextWindow?: number;
  maxCharsPerLine?: number;
  maxLines?: number;
  verbose?: boolean;
  help?: boolean;
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

  const adapter = createOllamaAdapter({
    transport: createNodeTransport(),
    config: {
      provider: "ollama",
      model: args.model ?? "qwen3.5:9b",
      baseUrl: args.baseUrl ?? "http://127.0.0.1:11434",
      temperature: 0,
      timeoutMs: args.timeoutMs ?? 300000,
      maxRetries: args.maxRetries ?? 2,
      onDebug: args.verbose ? (message) => stderr.write(`[debug] ${message}\n`) : undefined,
    },
  });

  const result = await translateSubtitleText({
    inputText,
    inputFileName,
    inputFormat: args.format,
    outputFormat: args.format,
    llmAdapter: adapter,
    options: {
      sourceLang: args.from ?? "en",
      targetLang: args.to ?? "vi",
      model: args.model ?? "qwen3.5:9b",
      temperature: 0,
      timeoutMs: args.timeoutMs ?? 300000,
      batchSize: args.batchSize ?? 2,
      contextWindow: args.contextWindow ?? 1,
      maxCharsPerLine: args.maxCharsPerLine ?? 42,
      maxLines: args.maxLines ?? 2,
      onProgress: args.verbose ? (message) => stderr.write(`[progress] ${message}\n`) : undefined,
    },
  });

  const out = args.output ?? suggestOutputPath({ inputSource, format: result.outputFormat });

  if (out === "-") {
    output.write(result.outputText);
    for (const warning of result.warnings) {
      stderr.write(`[warn] ${warning}\n`);
    }
    return;
  }

  await writeTextFile({ path: out, content: result.outputText });
  stderr.write(`Wrote translated subtitles to ${out}\n`);
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
  --format <srt|vtt|json>  Explicit input/output format
  --base-url <url>     Ollama base URL (default: http://127.0.0.1:11434)
  --batch-size <n>     Batch size per LLM call (default: 2)
  --timeout-ms <ms>    Request timeout per batch (default: 300000)
  --max-retries <n>    Retries per batch request (default: 2)
  --context-window <n> Context items on each side (default: 1)
  --max-chars-per-line <n>  Line reflow character limit (default: 42)
  --max-lines <n>      Max lines per subtitle block (default: 2)
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
