export function parseSrtTimestampToMs(params: { value: string }): number {
  const match = params.value.trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) {
    throw new Error(`Invalid SRT timestamp: ${params.value}`);
  }
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3600000 + Number(mm) * 60000 + Number(ss) * 1000 + Number(ms);
}

export function parseVttTimestampToMs(params: { value: string }): number {
  const match = params.value.trim().match(/^(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) {
    throw new Error(`Invalid VTT timestamp: ${params.value}`);
  }
  const [, hhMaybe, mm, ss, ms] = match;
  const hh = hhMaybe ? Number(hhMaybe) : 0;
  return hh * 3600000 + Number(mm) * 60000 + Number(ss) * 1000 + Number(ms);
}

export function formatSrtTimestamp(params: { ms: number }): string {
  const clamped = Math.max(0, Math.floor(params.ms));
  const hh = Math.floor(clamped / 3600000);
  const mm = Math.floor((clamped % 3600000) / 60000);
  const ss = Math.floor((clamped % 60000) / 1000);
  const ms = clamped % 1000;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)},${pad(ms, 3)}`;
}

export function formatVttTimestamp(params: { ms: number }): string {
  const clamped = Math.max(0, Math.floor(params.ms));
  const hh = Math.floor(clamped / 3600000);
  const mm = Math.floor((clamped % 3600000) / 60000);
  const ss = Math.floor((clamped % 60000) / 1000);
  const ms = clamped % 1000;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}.${pad(ms, 3)}`;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}
