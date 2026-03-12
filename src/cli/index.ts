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
      timeoutMs: 120000,
      maxRetries: 2,
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

    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${token}`);
    }

    switch (token) {
      case "--in":
        args.input = value;
        i += 1;
        break;
      case "--out":
        args.output = value;
        i += 1;
        break;
      case "--from":
        args.from = value;
        i += 1;
        break;
      case "--to":
        args.to = value;
        i += 1;
        break;
      case "--model":
        args.model = value;
        i += 1;
        break;
      case "--format":
        args.format = parseFormat({ value });
        i += 1;
        break;
      case "--base-url":
        args.baseUrl = value;
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
  --help               Show this help
`);
}

main().catch((error: unknown) => {
  stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
