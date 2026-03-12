import type { HttpTransport, LlmProviderConfig, TranslateBatchParams, TranslateBatchResult } from "../../types.js";

export interface CreateOllamaAdapterParams {
  transport: HttpTransport;
  config?: LlmProviderConfig;
}

export function createOllamaAdapter(params: CreateOllamaAdapterParams) {
  const config = {
    provider: "ollama" as const,
    model: "qwen3.5:9b",
    baseUrl: "http://127.0.0.1:11434",
    temperature: 0,
    timeoutMs: 120000,
    maxRetries: 2,
    ...(params.config ?? {}),
  };

  return {
    async translateBatch(batchParams: TranslateBatchParams): Promise<TranslateBatchResult> {
      const model = batchParams.model ?? config.model;
      const timeoutMs = batchParams.timeoutMs ?? config.timeoutMs;
      const temperature = batchParams.temperature ?? config.temperature;

      let lastError: unknown;
      let lastModelSnippet: string | undefined;
      let attemptsUsed = 0;
      for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        attemptsUsed = attempt + 1;
        try {
          config.onDebug?.(
            `Ollama request attempt ${attempt + 1}/${config.maxRetries + 1} model=${model} timeoutMs=${timeoutMs} items=${batchParams.items.length}`,
          );
          const response = await params.transport.request({
            method: "POST",
            url: `${config.baseUrl}/api/chat`,
            headers: {
              "content-type": "application/json",
            },
            timeoutMs,
            body: JSON.stringify({
              model,
              stream: false,
              format: "json",
              options: {
                temperature,
              },
              messages: [
                {
                  role: "system",
                  content:
                    "You are a subtitle translator. Return strict JSON only. No markdown. No explanation.",
                },
                {
                  role: "user",
                  content: buildUserPrompt({ batchParams }),
                },
              ],
            }),
          });

          if (response.status < 200 || response.status >= 300) {
            throw new Error(`Ollama request failed with status ${response.status}: ${response.bodyText}`);
          }

          const parsedResponse = JSON.parse(response.bodyText) as {
            message?: { content?: string };
            response?: string;
          };
          const modelText = parsedResponse.message?.content ?? parsedResponse.response ?? "";
          try {
            return parseOllamaTranslationJson({ modelText });
          } catch (parseError) {
            lastModelSnippet = buildSnippet({ text: modelText });
            throw new NonRetryableModelOutputError(
              `Failed to parse Ollama translation payload: ${errorToString({ error: parseError })}. Snippet: ${lastModelSnippet}`,
            );
          }
        } catch (error) {
          lastError = error;
          config.onDebug?.(
            `Ollama request attempt ${attempt + 1}/${config.maxRetries + 1} failed: ${errorToString({ error })}`,
          );
          if (error instanceof NonRetryableModelOutputError) {
            break;
          }
        }
      }

      throw new Error(
        `Ollama translation failed after ${attemptsUsed} attempt(s) (model=${model}, timeoutMs=${timeoutMs}, items=${batchParams.items.length}): ${errorToString({ error: lastError })}${lastModelSnippet ? ` | last snippet: ${lastModelSnippet}` : ""}`,
      );
    },
  };
}

class NonRetryableModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableModelOutputError";
  }
}

function buildUserPrompt(params: { batchParams: TranslateBatchParams }): string {
  const payload = {
    task: "translate_subtitle_batch",
    sourceLang: params.batchParams.sourceLang,
    targetLang: params.batchParams.targetLang,
    rules: [
      "Translate each item text only.",
      "Do not merge or split items.",
      "Keep item id exactly.",
      "Output JSON object with key translations.",
      "translations must be an array of {id, text}.",
    ],
    items: params.batchParams.items,
    outputSchema: {
      translations: [{ id: "string", text: "string" }],
    },
  };

  return JSON.stringify(payload);
}

export function parseOllamaTranslationJson(params: { modelText: string }): TranslateBatchResult {
  const candidate = extractJsonCandidate({ text: params.modelText });
  const parsed = JSON.parse(candidate) as unknown;
  const translatedById = collectTranslatedById({ parsed });

  if (Object.keys(translatedById).length === 0) {
    throw new Error("Invalid model output: no usable translations found");
  }

  return {
    translatedById,
    rawText: params.modelText,
  };
}

function extractJsonCandidate(params: { text: string }): string {
  const trimmed = params.text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Model output did not contain JSON object");
}

function errorToString(params: { error: unknown }): string {
  if (params.error instanceof Error) {
    return `${params.error.name}: ${params.error.message}`;
  }
  return String(params.error);
}

function buildSnippet(params: { text: string }): string {
  const compact = params.text.replace(/\s+/g, " ").trim();
  if (!compact) return "<empty>";
  const maxLen = 280;
  return compact.length <= maxLen ? compact : `${compact.slice(0, maxLen)}...`;
}

function collectTranslatedById(params: { parsed: unknown }): Record<string, string> {
  const output: Record<string, string> = {};

  const readArray = (items: unknown[]): void => {
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const id = item.id;
      const text = item.text ?? item.translation;
      if (typeof id === "string" && typeof text === "string") {
        output[id] = text;
      } else if (typeof id === "number" && typeof text === "string") {
        output[String(id)] = text;
      }
    }
  };

  if (Array.isArray(params.parsed)) {
    readArray(params.parsed);
    return output;
  }

  if (!params.parsed || typeof params.parsed !== "object") {
    return output;
  }

  const root = params.parsed as Record<string, unknown>;

  if (Array.isArray(root.translations)) readArray(root.translations);
  if (Array.isArray(root.subtitles)) readArray(root.subtitles);
  if (Array.isArray(root.items)) readArray(root.items);

  if (root.byId && typeof root.byId === "object" && !Array.isArray(root.byId)) {
    for (const [key, value] of Object.entries(root.byId as Record<string, unknown>)) {
      if (typeof value === "string") output[key] = value;
    }
  }

  for (const [key, value] of Object.entries(root)) {
    if (/^\d+$/.test(key) && typeof value === "string") {
      output[key] = value;
    }
  }

  return output;
}
