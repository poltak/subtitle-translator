import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, parseSubtitle, serializeSubtitle } from '../dist/index.js';

const SAMPLE_SRT = `1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:03,000 --> 00:00:05,000\nWorld\n`;

test('detectFormat infers srt', () => {
  const format = detectFormat({ text: SAMPLE_SRT, fileName: 'movie.srt' });
  assert.equal(format, 'srt');
});

test('parse and serialize srt keeps items count and timestamps', () => {
  const doc = parseSubtitle({ text: SAMPLE_SRT, format: 'srt' });
  assert.equal(doc.items.length, 2);
  assert.equal(doc.items[0].startMs, 1000);

  const out = serializeSubtitle({ doc, format: 'srt' });
  assert.match(out, /00:00:01,000 --> 00:00:03,000/);
});
