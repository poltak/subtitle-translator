import type { HttpTransport } from "../../types.js";

export function createNodeTransport(): HttpTransport {
  return {
    async request(params) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 120000);
      try {
        const response = await fetch(params.url, {
          method: params.method,
          headers: params.headers,
          body: params.body,
          signal: controller.signal,
        });
        return {
          status: response.status,
          bodyText: await response.text(),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
