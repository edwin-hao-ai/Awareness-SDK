import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyNoiseEvent, shouldStoreMemoryEvent } from '../src/core/noise-filter.mjs';

test('classifyNoiseEvent filters obvious session checkpoints and structurally low-signal content', () => {
  assert.equal(
    classifyNoiseEvent({
      event_type: 'session_checkpoint',
      content: 'partial assistant output',
    }),
    'session_checkpoint filtered',
  );

  assert.equal(
    classifyNoiseEvent({
      content: 'ok',
    }),
    'low_signal_noise filtered',
  );
});

test('classifyNoiseEvent filters terse untitled content but keeps intentional titled content', () => {
  assert.equal(
    classifyNoiseEvent({
      content: '收到',
    }),
    'low_signal_noise filtered',
  );

  assert.equal(
    classifyNoiseEvent({
      content: '已完成',
    }),
    'low_signal_noise filtered',
  );

  assert.equal(
    classifyNoiseEvent({
      title: 'User Preference',
      content: 'Use tabs',
    }),
    null,
  );
});

test('shouldStoreMemoryEvent keeps meaningful detailed records and structured insights', () => {
  assert.equal(
    shouldStoreMemoryEvent({
      content: 'We switched auth refresh handling to sliding sessions after verifying token expiry behavior.',
    }),
    true,
  );

  assert.equal(
    shouldStoreMemoryEvent({
      content: 'done',
      insights: {
        completed_tasks: [{ task_id: 'task_1', reason: 'implemented and verified' }],
      },
    }),
    true,
  );
});
