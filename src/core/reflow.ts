export interface ReflowParams {
  text: string;
  maxCharsPerLine: number;
  maxLines: number;
}

export function reflowText(params: ReflowParams): string[] {
  const normalized = params.text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= params.maxCharsPerLine) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word);
      current = "";
    }
  }

  if (current) lines.push(current);

  if (lines.length <= params.maxLines) {
    return lines;
  }

  const head = lines.slice(0, params.maxLines - 1);
  const tail = lines.slice(params.maxLines - 1).join(" ");
  return [...head, tail];
}
