import test from 'node:test';
import assert from 'node:assert/strict';

import { getToolDefinitions, buildRecallSummaryContent } from '../src/daemon/mcp-contract.mjs';
import { buildInitResult } from '../src/daemon/mcp-handlers.mjs';
import { SearchEngine } from '../src/core/search.mjs';

test('getToolDefinitions exposes perception in awareness_lookup schema', () => {
  const tools = getToolDefinitions();
  const lookupTool = tools.find((tool) => tool.name === 'awareness_lookup');

  assert.ok(lookupTool, 'awareness_lookup tool should exist');
  assert.ok(
    lookupTool.inputSchema.properties.type.enum.includes('perception'),
    'lookup schema should expose perception type'
  );
});

test('getToolDefinitions exposes cloud-aligned recall flags', () => {
  const tools = getToolDefinitions();
  const recallTool = tools.find((tool) => tool.name === 'awareness_recall');

  assert.ok(recallTool, 'awareness_recall tool should exist');
  assert.ok(recallTool.inputSchema.properties.multi_level);
  assert.ok(recallTool.inputSchema.properties.cluster_expand);
  assert.ok(recallTool.inputSchema.properties.include_installed);
});

test('getToolDefinitions exposes query on awareness_init for current-focus shaping', () => {
  const tools = getToolDefinitions();
  const initTool = tools.find((tool) => tool.name === 'awareness_init');

  assert.ok(initTool, 'awareness_init tool should exist');
  assert.ok(initTool.inputSchema.properties.query);
});

test('buildRecallSummaryContent returns readable text plus ids metadata block', () => {
  const response = buildRecallSummaryContent([
    { id: 'mem_1', type: 'decision', title: 'Use Redis', summary: 'Picked Redis for queue state.' },
    { id: 'mem_2', type: 'workflow', title: 'Deploy flow', summary: 'Run compose after pull.' },
  ]);

  assert.equal(response.content.length, 2);
  assert.match(response.content[0].text, /Found 2 memories/);

  const meta = JSON.parse(response.content[1].text);
  assert.deepEqual(meta._ids, ['mem_1', 'mem_2']);
  assert.equal(meta._meta.detail, 'summary');
  assert.equal(meta._meta.total, 2);
  assert.equal(meta._meta.mode, 'local');
});

test('buildInitResult keeps preference-first, active skills, and attention summary', () => {
  const fakeIndexer = {
    getStats: () => ({ totalMemories: 3, totalKnowledge: 4, totalTasks: 2, totalSessions: 2 }),
    getRecentKnowledge: (limit) => {
      const cards = [
        { id: 'pref_1', category: 'personal_preference', title: 'Prefers TypeScript', summary: 'Use TS by default.' },
        { id: 'skill_1', category: 'skill', title: 'Deploy with Docker', summary: 'Use compose.', methods: ['Pull', 'Build', 'Up'] },
        { id: 'dec_1', category: 'decision', title: 'Redis for cache', summary: 'Chose Redis for caching.' },
        { id: 'pit_1', category: 'pitfall', title: 'Beware stale pid', summary: 'Clean stale pid files.' },
      ];
      return cards.slice(0, limit);
    },
    getOpenTasks: () => [
      { id: 'task_1', title: 'Old task', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'task_2', title: 'Fresh task', created_at: new Date().toISOString() },
    ],
    getRecentSessions: () => [
      { id: 'ses_1', memory_count: 1, summary: 'Recent work' },
      { id: 'ses_2', memory_count: 0, summary: '' },
    ],
    db: {
      prepare: () => ({
        get: () => ({ cnt: 1 }),
      }),
    },
  };

  const initResult = buildInitResult({
    createSession: () => ({ id: 'ses_new' }),
    indexer: fakeIndexer,
    loadSpec: () => ({ init_guides: { sub_agent_guide: 'Follow the rules' } }),
    source: 'test',
    days: 7,
    maxCards: 4,
    maxTasks: 2,
    renderContextOptions: { currentFocus: 'How should auth be implemented?' },
  });

  assert.equal(initResult.session_id, 'ses_new');
  assert.equal(initResult.mode, 'local');
  assert.equal(initResult.user_preferences.length, 1);
  assert.equal(initResult.user_preferences[0].category, 'personal_preference');
  assert.equal(initResult.active_skills.length, 1);
  assert.equal(initResult.active_skills[0].title, 'Deploy with Docker');
  assert.equal(initResult.attention_summary.high_risks, 1);
  assert.equal(initResult.attention_summary.total_open_tasks, 2);
  assert.equal(initResult.attention_summary.needs_attention, true);
  assert.ok(Array.isArray(initResult.knowledge_cards));
  assert.ok(initResult.rendered_context);
  assert.match(initResult.rendered_context, /<current-focus>/);
  assert.match(initResult.rendered_context, /How should auth be implemented\?/);
});

test('SearchEngine.searchCloud forwards cloud-aligned recall flags', async () => {
  const originalFetch = global.fetch;

  try {
    let capturedBody = null;
    global.fetch = async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ result: { results: [] } }),
      };
    };

    const search = new SearchEngine(
      {},
      {},
      null,
      {
        apiBase: 'https://example.com',
        apiKey: 'test-key',
        memoryId: 'mem_1',
      }
    );

    await search.searchCloud({
      semantic_query: 'auth flow',
      keyword_query: 'jwt login',
      scope: 'all',
      limit: 8,
      multi_level: true,
      cluster_expand: false,
      include_installed: false,
    });

    const args = capturedBody.params.arguments;
    assert.equal(args.multi_level, true);
    assert.equal(args.cluster_expand, false);
    assert.equal(args.include_installed, false);
  } finally {
    global.fetch = originalFetch;
  }
});
