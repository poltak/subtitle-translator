import type { SubtitleDoc, SubtitleFormat, SubtitleItem } from "../types.js";
import {
  formatSrtTimestamp,
  formatVttTimestamp,
  parseSrtTimestampToMs,
  parseVttTimestampToMs,
} from "./timing.js";

export function detectFormat(params: { text: string; fileName?: string }): SubtitleFormat {
  if (params.fileName?.toLowerCase().endsWith(".srt")) return "srt";
  if (params.fileName?.toLowerCase().endsWith(".vtt")) return "vtt";
  if (params.fileName?.toLowerCase().endsWith(".json")) return "json";

  const trimmed = params.text.trimStart();
  if (trimmed.startsWith("WEBVTT")) return "vtt";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "srt";
}

export function parseSubtitle(params: { text: string; format: SubtitleFormat }): SubtitleDoc {
  if (params.format === "json") {
    return parseJson({ text: params.text });
  }
  if (params.format === "vtt") {
    return parseVtt({ text: params.text });
  }
  return parseSrt({ text: params.text });
}

export function serializeSubtitle(params: { doc: SubtitleDoc; format: SubtitleFormat }): string {
  if (params.format === "json") {
    return `${JSON.stringify(params.doc, null, 2)}\n`;
  }
  if (params.format === "vtt") {
    return serializeVtt({ doc: params.doc });
  }
  return serializeSrt({ doc: params.doc });
}

function parseJson(params: { text: string }): SubtitleDoc {
  const parsed = JSON.parse(params.text) as SubtitleDoc;
  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error("Invalid JSON subtitle format: missing items array");
  }
  return {
    ...parsed,
    format: "json",
  };
}

function parseSrt(params: { text: string }): SubtitleDoc {
  const normalized = params.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return { format: "srt", items: [] };

  const blocks = normalized.split(/\n\s*\n/g);
  const items: SubtitleItem[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 2) continue;

    const hasIndex = /^\d+$/.test(lines[0].trim());
    const index = hasIndex ? Number(lines[0].trim()) : items.length + 1;
    const timingLine = hasIndex ? lines[1] : lines[0];
    const textLines = hasIndex ? lines.slice(2) : lines.slice(1);

    const timingMatch = timingLine.match(/^(.+?)\s*-->\s*(.+?)$/);
    if (!timingMatch) {
      throw new Error(`Invalid SRT timing line: ${timingLine}`);
    }

    const startMs = parseSrtTimestampToMs({ value: timingMatch[1].trim() });
    const endMs = parseSrtTimestampToMs({ value: timingMatch[2].trim() });

    items.push({
      index,
      startMs,
      endMs,
      lines: textLines,
      text: textLines.join("\n").trim(),
    });
  }

  return { format: "srt", items };
}

function parseVtt(params: { text: string }): SubtitleDoc {
  const normalized = params.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return { format: "vtt", items: [] };

  const lines = normalized.split("\n");
  let cursor = 0;
  if (lines[0].startsWith("WEBVTT")) {
    cursor = 1;
    while (cursor < lines.length && lines[cursor].trim() === "") {
      cursor += 1;
    }
  }

  const body = lines.slice(cursor).join("\n");
  const blocks = body.split(/\n\s*\n/g).filter(Boolean);

  const items: SubtitleItem[] = [];

  for (const block of blocks) {
    const blockLines = block.split("\n");
    if (blockLines.length === 0) continue;

    let timingLine = blockLines[0];
    let textStart = 1;
    if (!timingLine.includes("-->") && blockLines.length >= 2) {
      timingLine = blockLines[1];
      textStart = 2;
    }

    const timingMatch = timingLine.match(/^(.+?)\s*-->\s*([^\s]+)(?:\s+.*)?$/);
    if (!timingMatch) {
      throw new Error(`Invalid VTT timing line: ${timingLine}`);
    }

    const startMs = parseVttTimestampToMs({ value: timingMatch[1].trim() });
    const endMs = parseVttTimestampToMs({ value: timingMatch[2].trim() });
    const textLines = blockLines.slice(textStart);

    items.push({
      index: items.length + 1,
      startMs,
      endMs,
      lines: textLines,
      text: textLines.join("\n").trim(),
    });
  }

  return { format: "vtt", items };
}

function serializeSrt(params: { doc: SubtitleDoc }): string {
  const blocks = params.doc.items.map((item, idx) => {
    const index = item.index ?? idx + 1;
    const text = item.lines?.length ? item.lines.join("\n") : item.text;
    return [
      String(index),
      `${formatSrtTimestamp({ ms: item.startMs })} --> ${formatSrtTimestamp({ ms: item.endMs })}`,
      text,
    ].join("\n");
  });

  return `${blocks.join("\n\n")}\n`;
}

function serializeVtt(params: { doc: SubtitleDoc }): string {
  const blocks = params.doc.items.map((item) => {
    const text = item.lines?.length ? item.lines.join("\n") : item.text;
    return [
      `${formatVttTimestamp({ ms: item.startMs })} --> ${formatVttTimestamp({ ms: item.endMs })}`,
      text,
    ].join("\n");
  });

  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}
