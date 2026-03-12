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
      for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        try {
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
          return parseOllamaTranslationJson({ modelText });
        } catch (error) {
          lastError = error;
        }
      }

      throw new Error(`Ollama translation failed after retries: ${String(lastError)}`);
    },
  };
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

function parseOllamaTranslationJson(params: { modelText: string }): TranslateBatchResult {
  const candidate = extractJsonCandidate({ text: params.modelText });
  const parsed = JSON.parse(candidate) as {
    translations?: Array<{ id?: string; text?: string }>;
  };

  if (!Array.isArray(parsed.translations)) {
    throw new Error("Invalid model output: missing translations array");
  }

  const translatedById: Record<string, string> = {};
  for (const item of parsed.translations) {
    if (!item.id || typeof item.text !== "string") continue;
    translatedById[item.id] = item.text;
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
