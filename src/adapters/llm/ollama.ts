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
    think: false,
    temperature: 0,
    timeoutMs: 120000,
    maxRetries: 2,
    ...(params.config ?? {}),
  };

  return {
    async translateBatch(batchParams: TranslateBatchParams): Promise<TranslateBatchResult> {
      const model = batchParams.model ?? config.model;
      const think = batchParams.think ?? config.think;
      const timeoutMs = batchParams.timeoutMs ?? config.timeoutMs;
      const temperature = batchParams.temperature ?? config.temperature;

      let lastError: unknown;
      let lastModelSnippet: string | undefined;
      let attemptsUsed = 0;
      for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
        attemptsUsed = attempt + 1;
        try {
          config.onDebug?.(
            `Ollama request attempt ${attempt + 1}/${config.maxRetries + 1} model=${model} think=${String(think)} timeoutMs=${timeoutMs} items=${batchParams.items.length}`,
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
              think,
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
            try {
              const corrected = await requestJsonCorrection({
                transport: params.transport,
                baseUrl: config.baseUrl,
                model,
                think,
                temperature,
                timeoutMs,
                invalidText: modelText,
              });
              config.onDebug?.("Ollama correction pass recovered invalid JSON payload");
              return parseOllamaTranslationJson({ modelText: corrected });
            } catch (correctionError) {
              config.onDebug?.(
                `Ollama correction pass failed: ${errorToString({ error: correctionError })}`,
              );
            }
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
        `Ollama translation failed after ${attemptsUsed} attempt(s) (model=${model}, think=${String(think)}, timeoutMs=${timeoutMs}, items=${batchParams.items.length}): ${errorToString({ error: lastError })}${lastModelSnippet ? ` | last snippet: ${lastModelSnippet}` : ""}`,
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

  const balanced = extractBalancedJsonObject({ text: trimmed });
  if (balanced) {
    return balanced;
  }

  const repaired = repairJsonObject({ text: trimmed });
  if (repaired) {
    return repaired;
  }

  throw new Error("Model output did not contain reparable JSON object");
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

async function requestJsonCorrection(params: {
  transport: HttpTransport;
  baseUrl: string;
  model: string;
  think: boolean;
  temperature: number;
  timeoutMs: number;
  invalidText: string;
}): Promise<string> {
  const response = await params.transport.request({
    method: "POST",
    url: `${params.baseUrl}/api/chat`,
    headers: {
      "content-type": "application/json",
    },
    timeoutMs: params.timeoutMs,
    body: JSON.stringify({
      model: params.model,
      think: params.think,
      stream: false,
      format: "json",
      options: {
        temperature: 0,
      },
      messages: [
        {
          role: "system",
          content:
            "You repair malformed JSON. Return only valid JSON matching the intended structure. Do not translate or change text content.",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "repair_translation_json",
            requiredShape: {
              translations: [{ id: "string", text: "string" }],
            },
            invalidJson: params.invalidText,
          }),
        },
      ],
    }),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ollama correction request failed with status ${response.status}: ${response.bodyText}`);
  }

  const parsedResponse = JSON.parse(response.bodyText) as {
    message?: { content?: string };
    response?: string;
  };
  return parsedResponse.message?.content ?? parsedResponse.response ?? "";
}

function extractBalancedJsonObject(params: { text: string }): string | undefined {
  const start = params.text.indexOf("{");
  if (start < 0) return undefined;

  let depthCurly = 0;
  let depthSquare = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < params.text.length; i += 1) {
    const char = params.text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") depthCurly += 1;
    if (char === "}") depthCurly -= 1;
    if (char === "[") depthSquare += 1;
    if (char === "]") depthSquare -= 1;

    if (depthCurly === 0 && depthSquare === 0) {
      return params.text.slice(start, i + 1);
    }
  }

  return undefined;
}

function repairJsonObject(params: { text: string }): string | undefined {
  const start = params.text.indexOf("{");
  if (start < 0) return undefined;

  const candidate = params.text.slice(start).trim();
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < candidate.length; i += 1) {
    const char = candidate[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") stack.push("}");
    if (char === "[") stack.push("]");
    if ((char === "}" || char === "]") && stack[stack.length - 1] === char) {
      stack.pop();
    }
  }

  const repaired = `${candidate}${stack.reverse().join("")}`;
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return undefined;
  }
}
