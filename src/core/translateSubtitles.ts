import type { LlmAdapter, SubtitleDoc, SubtitleItem, TranslateOptions } from "../types.js";
import { buildTranslateBatches } from "./batching.js";
import { normalizeSubtitleDoc } from "./normalize.js";
import { reflowText } from "./reflow.js";

export interface TranslateSubtitlesParams {
  doc: SubtitleDoc;
  llmAdapter: LlmAdapter;
  options?: TranslateOptions;
}

export interface TranslateSubtitlesResult {
  doc: SubtitleDoc;
  warnings: string[];
}

const DEFAULTS = {
  sourceLang: "en",
  targetLang: "vi",
  batchSize: 40,
  maxCharsPerLine: 42,
  maxLines: 2,
  preserveLineBreaks: false,
  contextWindow: 1,
  temperature: 0,
  timeoutMs: 120000,
} as const;

export async function translateSubtitles(params: TranslateSubtitlesParams): Promise<TranslateSubtitlesResult> {
  const normalized = normalizeSubtitleDoc({ doc: params.doc });
  const options = { ...DEFAULTS, ...(params.options ?? {}) };

  const batches = buildTranslateBatches({
    items: normalized.items,
    batchSize: options.batchSize,
    contextWindow: options.contextWindow,
  });

  const translatedByIndex: Record<number, string> = {};
  const warnings: string[] = [];

  for (const batch of batches) {
    const result = await params.llmAdapter.translateBatch({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      items: batch,
      model: options.model,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
    });

    for (const item of batch) {
      const translated = result.translatedById[item.id];
      if (!translated || !translated.trim()) {
        const warning = `Missing translation for subtitle index ${item.id}; preserving source text.`;
        warnings.push(warning);
        options.onWarning?.(warning);
        translatedByIndex[Number(item.id)] = item.text;
        continue;
      }
      translatedByIndex[Number(item.id)] = translated.trim();
    }
  }

  const items = normalized.items.map((item) => translateItem({ item, translatedByIndex, options }));

  return {
    doc: {
      ...normalized,
      sourceLanguage: options.sourceLang,
      targetLanguage: options.targetLang,
      items,
    },
    warnings,
  };
}

function translateItem(params: {
  item: SubtitleItem;
  translatedByIndex: Record<number, string>;
  options: Required<Pick<
    TranslateOptions,
    "maxCharsPerLine" | "maxLines" | "preserveLineBreaks"
  >>;
}): SubtitleItem {
  const translated = params.translatedByIndex[params.item.index] ?? params.item.text;

  if (params.options.preserveLineBreaks) {
    return {
      ...params.item,
      text: translated,
      lines: translated.split("\n"),
    };
  }

  const lines = reflowText({
    text: translated,
    maxCharsPerLine: params.options.maxCharsPerLine,
    maxLines: params.options.maxLines,
  });

  return {
    ...params.item,
    text: lines.join("\n") || translated,
    lines,
  };
}
