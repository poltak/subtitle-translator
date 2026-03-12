import type {
  LlmAdapter,
  SubtitleDoc,
  SubtitleItem,
  TranslateBatchItem,
  TranslateOptions,
} from "../types.js";
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
  batchSize: 2,
  maxCharsPerLine: 42,
  maxLines: 2,
  preserveLineBreaks: false,
  contextWindow: 1,
  temperature: 0,
  timeoutMs: 300000,
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

  const totalBatches = batches.length;
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const batchStart = Date.now();
    options.onProgress?.(
      `Batch ${i + 1}/${totalBatches}: translating subtitle indices ${batch[0]?.id}..${batch[batch.length - 1]?.id} (${batch.length} items)`,
    );

    const resilient = await translateBatchResilient({
      llmAdapter: params.llmAdapter,
      batch,
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      model: options.model,
      temperature: options.temperature,
      timeoutMs: options.timeoutMs,
      onProgress: options.onProgress,
      onWarning: options.onWarning,
    });
    const elapsedMs = Date.now() - batchStart;
    options.onProgress?.(`Batch ${i + 1}/${totalBatches} completed in ${(elapsedMs / 1000).toFixed(1)}s`);
    warnings.push(...resilient.warnings);

    for (const item of batch) {
      const translated = resilient.translatedById[item.id];
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

interface ResilientBatchParams {
  llmAdapter: LlmAdapter;
  batch: TranslateBatchItem[];
  sourceLang: string;
  targetLang: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  onProgress?: (message: string) => void;
  onWarning?: (warning: string) => void;
}

async function translateBatchResilient(params: ResilientBatchParams): Promise<{
  translatedById: Record<string, string>;
  warnings: string[];
}> {
  try {
    const result = await params.llmAdapter.translateBatch({
      sourceLang: params.sourceLang,
      targetLang: params.targetLang,
      items: params.batch,
      model: params.model,
      temperature: params.temperature,
      timeoutMs: params.timeoutMs,
    });
    return { translatedById: result.translatedById, warnings: [] };
  } catch (error) {
    if (params.batch.length === 1) {
      const single = params.batch[0];
      const warning =
        `Translation failed for subtitle index ${single.id}; preserving source text. Cause: ${formatError({ error })}`;
      params.onWarning?.(warning);
      return {
        translatedById: { [single.id]: single.text },
        warnings: [warning],
      };
    }

    const mid = Math.ceil(params.batch.length / 2);
    const left = params.batch.slice(0, mid);
    const right = params.batch.slice(mid);
    params.onProgress?.(
      `Batch fallback: split ${params.batch.length} items into ${left.length}+${right.length} after error: ${formatError({ error })}`,
    );

    const leftResult = await translateBatchResilient({
      ...params,
      batch: left,
    });
    const rightResult = await translateBatchResilient({
      ...params,
      batch: right,
    });

    return {
      translatedById: {
        ...leftResult.translatedById,
        ...rightResult.translatedById,
      },
      warnings: [...leftResult.warnings, ...rightResult.warnings],
    };
  }
}

function formatError(params: { error: unknown }): string {
  if (params.error instanceof Error) {
    return `${params.error.name}: ${params.error.message}`;
  }
  return String(params.error);
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
