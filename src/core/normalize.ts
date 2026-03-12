import type { SubtitleDoc, SubtitleItem } from "../types.js";

export function normalizeText(params: { text: string }): string {
  return params.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function normalizeSubtitleDoc(params: { doc: SubtitleDoc }): SubtitleDoc {
  const items = params.doc.items
    .map((item) => normalizeItem({ item }))
    .sort((a, b) => a.index - b.index);

  return {
    ...params.doc,
    items,
  };
}

function normalizeItem(params: { item: SubtitleItem }): SubtitleItem {
  const text = normalizeText({ text: params.item.text });
  return {
    ...params.item,
    startMs: Math.floor(params.item.startMs),
    endMs: Math.floor(params.item.endMs),
    text,
    lines: text.split("\n"),
  };
}
