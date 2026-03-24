export type SubtitleFormat = "srt" | "vtt" | "json";

export interface SubtitleItem {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  lines?: string[];
}

export interface SubtitleDoc {
  format?: SubtitleFormat;
  sourceLanguage?: string;
  targetLanguage?: string;
  items: SubtitleItem[];
}

export interface TranslateBatchItem {
  id: string;
  text: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface TranslateBatchParams {
  sourceLang: string;
  targetLang: string;
  items: TranslateBatchItem[];
  model?: string;
  promptMode?: "default" | "fast";
  think?: boolean;
  temperature?: number;
  timeoutMs?: number;
}

export interface TranslateBatchResult {
  translatedById: Record<string, string>;
  rawText?: string;
}

export interface LlmAdapter {
  translateBatch(params: TranslateBatchParams): Promise<TranslateBatchResult>;
}

export interface TranslateOptions {
  sourceLang?: string;
  targetLang?: string;
  batchSize?: number;
  maxCharsPerLine?: number;
  maxLines?: number;
  preserveLineBreaks?: boolean;
  contextWindow?: number;
  model?: string;
  promptMode?: "default" | "fast";
  think?: boolean;
  temperature?: number;
  timeoutMs?: number;
  onWarning?: (warning: string) => void;
  onProgress?: (message: string) => void;
  initialTranslatedByIndex?: Record<number, string>;
  onBatchCommitted?: (params: {
    translatedByIndex: Record<number, string>;
    completedBatches: number;
    totalBatches: number;
  }) => void | Promise<void>;
}

export interface HttpRequestParams {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  bodyText: string;
}

export interface HttpTransport {
  request(params: HttpRequestParams): Promise<HttpResponse>;
}

export interface LlmProviderConfig {
  provider?: "ollama";
  model?: string;
  baseUrl?: string;
  think?: boolean;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
  onDebug?: (message: string) => void;
}
