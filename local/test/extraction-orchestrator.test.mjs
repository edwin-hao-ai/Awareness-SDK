/**
 * Tests for extraction-orchestrator.mjs — F-031 Phase 1 Task 4.5
 *
 * Covers:
 * - v1 single-pass extraction
 * - v2 multi-pass extraction (Pass 1 → Pass 2)
 * - JSON parsing (clean, markdown-fenced, invalid)
 * - Timeout handling
 * - Fallback behavior
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { executeMultiPassExtraction } from '../src/core/extraction-orchestrator.mjs';

// ---- Test Data ----

function makeV1Request() {
  return {
    memory_id: 'mem_1',
    session_id: 'ses_1',
    schema_version: 1,
    events: [
      { content: 'We decided to use JWT for auth', event_type: 'message', source: 'user' },
      { content: 'Implemented JWT token rotation', event_type: 'message', source: 'assistant' },
    ],
    existing_cards: [],
    existing_tasks: [],
    system_prompt: 'Extract insights from events. {existing_cards} {existing_tasks}',
  };
}

function makeV2Request() {
  return {
    memory_id: 'mem_1',
    session_id: 'ses_1',
    schema_version: 2,
    passes: [
      {
        pass: 1,
        events: [
          { content: 'Decided to use JWT for auth', event_type: 'message', source: 'user' },
          { content: 'Implemented rotation', event_type: 'message', source: 'assistant' },
        ],
        system_prompt: 'Extract claims as bullet list.',
      },
      {
        pass: 2,
        events: [
          { content: 'Decided to use JWT for auth', event_type: 'message', source: 'user' },
        ],
        existing_cards: [{ id: 'kc_1', title: 'Old card', summary: 'Old info', category: 'decision' }],
        existing_tasks: [{ id: 'task_1', title: 'Fix auth', status: 'pending', priority: 'high' }],
        system_prompt: 'Synthesize cards. {existing_cards} {existing_tasks}',
      },
    ],
  };
}

const SAMPLE_EXTRACTION_JSON = JSON.stringify({
  knowledge_cards: [
    { title: 'JWT for auth', category: 'decision', summary: 'We chose JWT', confidence: 0.9 },
  ],
  risks: [],
  action_items: [],
  completed_tasks: [],
  turn_brief: 'Decided on JWT.',
});

// ---- v1 Single-Pass Tests ----

describe('executeMultiPassExtraction — v1', () => {
  it('executes single-pass for schema_version 1', async () => {
    const mockLLM = mock.fn(async () => SAMPLE_EXTRACTION_JSON);

    const result = await executeMultiPassExtraction(makeV1Request(), {
      llmInfer: mockLLM,
    });

    assert.equal(mockLLM.mock.calls.length, 1);
    assert.equal(result.knowledge_cards.length, 1);
    assert.equal(result.knowledge_cards[0].title, 'JWT for auth');
  });
});

// ---- v2 Multi-Pass Tests ----

describe('executeMultiPassExtraction — v2', () => {
  it('executes two passes sequentially', async () => {
    let callCount = 0;
    const mockLLM = mock.fn(async (prompt, content) => {
      callCount++;
      if (callCount === 1) {
        // Pass 1: return bullet list
        return '- JWT was chosen for authentication\n- Token rotation was implemented';
      }
      // Pass 2: return structured JSON
      return SAMPLE_EXTRACTION_JSON;
    });

    const result = await executeMultiPassExtraction(makeV2Request(), {
      llmInfer: mockLLM,
    });

    assert.equal(mockLLM.mock.calls.length, 2);
    assert.equal(result.knowledge_cards.length, 1);
    assert.equal(result.turn_brief, 'Decided on JWT.');
  });

  it('calls onPassComplete callback for each pass', async () => {
    const completedPasses = [];
    const mockLLM = mock.fn(async () => SAMPLE_EXTRACTION_JSON);

    await executeMultiPassExtraction(makeV2Request(), {
      llmInfer: mockLLM,
      onPassComplete: (passNum, output) => completedPasses.push(passNum),
    });

    assert.deepEqual(completedPasses, [1, 2]);
  });

  it('falls back to events text if Pass 1 fails', async () => {
    let callCount = 0;
    const mockLLM = mock.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('LLM unavailable');
      return SAMPLE_EXTRACTION_JSON;
    });

    const result = await executeMultiPassExtraction(makeV2Request(), {
      llmInfer: mockLLM,
    });

    // Pass 2 should still run with events text as claims
    assert.equal(result.knowledge_cards.length, 1);
  });

  it('returns empty result if Pass 2 fails', async () => {
    const mockLLM = mock.fn(async () => { throw new Error('LLM down'); });

    const result = await executeMultiPassExtraction(makeV2Request(), {
      llmInfer: mockLLM,
    });

    assert.deepEqual(result.knowledge_cards, []);
    assert.deepEqual(result.risks, []);
  });
});

// ---- JSON Parsing ----

describe('executeMultiPassExtraction — JSON parsing', () => {
  it('parses markdown-fenced JSON', async () => {
    const mockLLM = mock.fn(async () => '```json\n' + SAMPLE_EXTRACTION_JSON + '\n```');

    const result = await executeMultiPassExtraction(makeV1Request(), {
      llmInfer: mockLLM,
    });

    assert.equal(result.knowledge_cards.length, 1);
  });

  it('returns empty on invalid JSON', async () => {
    const mockLLM = mock.fn(async () => 'This is not JSON at all');

    const result = await executeMultiPassExtraction(makeV1Request(), {
      llmInfer: mockLLM,
    });

    assert.deepEqual(result.knowledge_cards, []);
  });
});

// ---- Error Handling ----

describe('executeMultiPassExtraction — errors', () => {
  it('throws if llmInfer is not provided', async () => {
    await assert.rejects(
      () => executeMultiPassExtraction(makeV1Request(), {}),
      /llmInfer function is required/,
    );
  });

  it('handles timeout gracefully', async () => {
    const slowLLM = mock.fn(async () => {
      return new Promise((resolve) => setTimeout(() => resolve(SAMPLE_EXTRACTION_JSON), 50000));
    });

    const result = await executeMultiPassExtraction(makeV1Request(), {
      llmInfer: slowLLM,
      timeoutMs: 100, // 100ms timeout
    });

    // Should return empty result (timeout triggered)
    assert.deepEqual(result.knowledge_cards, []);
  });
});
