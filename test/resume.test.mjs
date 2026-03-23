import test from 'node:test';
import assert from 'node:assert/strict';
import { translateSubtitles } from '../dist/index.js';

const baseDoc = {
  items: [
    { index: 1, startMs: 1000, endMs: 2000, text: 'Hello one' },
    { index: 2, startMs: 2100, endMs: 3200, text: 'Hello two' },
  ],
};

test('translateSubtitles resumes from initialTranslatedByIndex', async () => {
  let calls = 0;
  const seenBatchSizes = [];
  const checkpoints = [];

  const llmAdapter = {
    async translateBatch(params) {
      calls += 1;
      seenBatchSizes.push(params.items.length);
      const translatedById = {};
      for (const item of params.items) {
        translatedById[item.id] = `VI ${item.id}`;
      }
      return { translatedById };
    },
  };

  const result = await translateSubtitles({
    doc: baseDoc,
    llmAdapter,
    options: {
      batchSize: 2,
      initialTranslatedByIndex: { 1: 'RESUMED 1' },
      onBatchCommitted: (state) => {
        checkpoints.push(state.completedBatches);
      },
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(seenBatchSizes, [1]);
  assert.equal(result.doc.items[0].text, 'RESUMED 1');
  assert.match(result.doc.items[1].text, /VI 2/);
  assert.deepEqual(checkpoints, [1]);
});
