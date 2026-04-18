#!/usr/bin/env node
/**
 * Sanity test for mcp-stdio.cjs arg normalization (2026-04-18 insights bug).
 * Zero-dependency, uses node:assert. Run with: node test-mcp-stdio-normalize.cjs
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { tryParseJson, normalizeToolArgs, TOOLS } = require('./mcp-stdio.cjs');

test('tryParseJson: returns non-string unchanged', () => {
  assert.deepEqual(tryParseJson({ a: 1 }), { a: 1 });
  assert.deepEqual(tryParseJson([1, 2]), [1, 2]);
  assert.equal(tryParseJson(42), 42);
  assert.equal(tryParseJson(null), null);
});

test('tryParseJson: parses JSON object string', () => {
  assert.deepEqual(tryParseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(tryParseJson('  {"x":"y"}  '), { x: 'y' });
});

test('tryParseJson: parses JSON array string', () => {
  assert.deepEqual(tryParseJson('[1,2,3]'), [1, 2, 3]);
});

test('tryParseJson: leaves non-JSON strings alone', () => {
  assert.equal(tryParseJson('plain sentence'), 'plain sentence');
  assert.equal(tryParseJson(''), '');
  assert.equal(tryParseJson('   '), '   ');
});

test('tryParseJson: invalid JSON stays as string', () => {
  assert.equal(tryParseJson('{bad json'), '{bad json');
  assert.equal(tryParseJson('[incomplete'), '[incomplete');
});

test('normalizeToolArgs: parses stringified insights', () => {
  const out = normalizeToolArgs({
    content: 'hi',
    insights: '{"knowledge_cards":[{"title":"t","summary":"s","category":"insight"}]}',
  });
  assert.equal(typeof out.insights, 'object');
  assert.equal(out.insights.knowledge_cards.length, 1);
  assert.equal(out.insights.knowledge_cards[0].title, 't');
});

test('normalizeToolArgs: parses stringified items + tags', () => {
  const out = normalizeToolArgs({
    items: '[{"content":"a"}]',
    tags: '["f-053","fix"]',
  });
  assert.ok(Array.isArray(out.items));
  assert.equal(out.items[0].content, 'a');
  assert.deepEqual(out.tags, ['f-053', 'fix']);
});

test('normalizeToolArgs: passes native objects through', () => {
  const obj = { knowledge_cards: [{ title: 'x' }] };
  const out = normalizeToolArgs({ insights: obj });
  assert.equal(out.insights, obj);  // same reference
});

test('normalizeToolArgs: returns {} for nullish', () => {
  assert.deepEqual(normalizeToolArgs(null), {});
  assert.deepEqual(normalizeToolArgs(undefined), {});
});

test('TOOLS: awareness_record has F-053 single-param shape', () => {
  const rec = TOOLS.find((t) => t.name === 'awareness_record');
  assert.ok(rec);
  assert.deepEqual(rec.inputSchema.required, ['content']);
  // insights intentionally has NO `type` (permissive for wire-stringify tolerance)
  const insights = rec.inputSchema.properties.insights;
  assert.ok(insights);
  assert.equal(insights.type, undefined, 'insights must not declare strict type');
});

test('TOOLS: awareness_recall has F-053 single-param shape', () => {
  const rec = TOOLS.find((t) => t.name === 'awareness_recall');
  assert.ok(rec);
  assert.deepEqual(rec.inputSchema.required, ['query']);
});
