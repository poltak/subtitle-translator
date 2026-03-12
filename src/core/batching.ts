import type { SubtitleItem, TranslateBatchItem } from "../types.js";

export interface BuildBatchesParams {
  items: SubtitleItem[];
  batchSize: number;
  contextWindow: number;
}

export function buildTranslateBatches(params: BuildBatchesParams): TranslateBatchItem[][] {
  const out: TranslateBatchItem[][] = [];
  const { items, batchSize, contextWindow } = params;

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    out.push(
      chunk.map((item) => {
        const indexInAll = items.findIndex((candidate) => candidate.index === item.index);
        const before = items
          .slice(Math.max(0, indexInAll - contextWindow), indexInAll)
          .map((value) => value.text);
        const after = items
          .slice(indexInAll + 1, Math.min(items.length, indexInAll + 1 + contextWindow))
          .map((value) => value.text);

        return {
          id: String(item.index),
          text: item.text,
          contextBefore: before,
          contextAfter: after,
        };
      }),
    );
  }

  return out;
}
