import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOllamaTranslationJson } from '../dist/adapters/llm/ollama.js';

test('parses translations array shape', () => {
  const parsed = parseOllamaTranslationJson({
    modelText: JSON.stringify({
      translations: [
        { id: '1', text: 'Xin chao' },
        { id: '2', text: 'Tam biet' },
      ],
    }),
  });

  assert.equal(parsed.translatedById['1'], 'Xin chao');
  assert.equal(parsed.translatedById['2'], 'Tam biet');
});

test('parses numeric-key object shape', () => {
  const parsed = parseOllamaTranslationJson({
    modelText: JSON.stringify({
      '1': 'Xin chao',
      '2': 'Tam biet',
    }),
  });

  assert.equal(parsed.translatedById['1'], 'Xin chao');
  assert.equal(parsed.translatedById['2'], 'Tam biet');
});

test('parses byId shape', () => {
  const parsed = parseOllamaTranslationJson({
    modelText: JSON.stringify({
      byId: {
        '10': 'Ban co khoe khong?',
      },
    }),
  });

  assert.equal(parsed.translatedById['10'], 'Ban co khoe khong?');
});

test('parses subtitles array shape', () => {
  const parsed = parseOllamaTranslationJson({
    modelText: JSON.stringify({
      subtitles: [
        { id: '1', text: 'Xin chao' },
        { id: '2', translation: 'Tam biet' },
      ],
    }),
  });

  assert.equal(parsed.translatedById['1'], 'Xin chao');
  assert.equal(parsed.translatedById['2'], 'Tam biet');
});
