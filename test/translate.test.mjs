import test from 'node:test';
import assert from 'node:assert/strict';
import { translateSubtitleText } from '../dist/index.js';

const mockAdapter = {
  async translateBatch(params) {
    const translatedById = {};
    for (const item of params.items) {
      translatedById[item.id] = `VI: ${item.text}`;
    }
    return { translatedById };
  },
};

test('translateSubtitleText preserves structure and rewrites text', async () => {
  const input = `1\n00:00:01,000 --> 00:00:02,000\nHello there\n`;
  const result = await translateSubtitleText({
    inputText: input,
    inputFormat: 'srt',
    outputFormat: 'srt',
    llmAdapter: mockAdapter,
    options: { sourceLang: 'en', targetLang: 'vi', maxCharsPerLine: 42, maxLines: 2 },
  });

  assert.match(result.outputText, /VI: Hello there/);
  assert.match(result.outputText, /00:00:01,000 --> 00:00:02,000/);
});
