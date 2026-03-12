import type { LlmAdapter, SubtitleFormat, TranslateOptions } from "../types.js";
import { detectFormat, parseSubtitle, serializeSubtitle } from "./format.js";
import { translateSubtitles } from "./translateSubtitles.js";

export interface TranslateSubtitleTextParams {
  inputText: string;
  inputFileName?: string;
  inputFormat?: SubtitleFormat;
  outputFormat?: SubtitleFormat;
  llmAdapter: LlmAdapter;
  options?: TranslateOptions;
}

export async function translateSubtitleText(params: TranslateSubtitleTextParams): Promise<{
  outputText: string;
  outputFormat: SubtitleFormat;
  warnings: string[];
}> {
  const inputFormat =
    params.inputFormat ?? detectFormat({ text: params.inputText, fileName: params.inputFileName });

  const doc = parseSubtitle({ text: params.inputText, format: inputFormat });
  const translated = await translateSubtitles({ doc, llmAdapter: params.llmAdapter, options: params.options });

  const outputFormat = params.outputFormat ?? (inputFormat === "json" ? "json" : inputFormat);
  const outputText = serializeSubtitle({ doc: translated.doc, format: outputFormat });

  return {
    outputText,
    outputFormat,
    warnings: translated.warnings,
  };
}
