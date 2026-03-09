const test = require("node:test");
const assert = require("node:assert/strict");
const { MemoryCloudClient } = require("../dist/index.js");

function jsonResponse(payload, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  return new Response(JSON.stringify(payload), { status: options.status || 200, headers });
}

async function withMockFetch(mockFetch, fn) {
  const original = global.fetch;
  global.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    global.fetch = original;
  }
}

test("recallForTask augments query and forwards retrieve options", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse(
      { results: [{ content: "context hit" }] },
      { headers: { "X-Trace-Id": "trace-recall-ts" } }
    );
  }, async () => {
    const client = new MemoryCloudClient({
      baseUrl: "http://localhost:8000/api/v1",
      apiKey: "test-key",
      maxRetries: 0,
      timeoutMs: 2000,
    });

    const result = await client.recallForTask({
      memoryId: "memory-1",
      task: "Summarize latest auth changes",
      limit: 999,
      source: "sdk demo",
      sessionId: "sess-fixed",
      useHybridSearch: false,
      useMmr: true,
      mmrLambda: 0.2,
      recallMode: "hybrid",
      scope: "knowledge",
      metadataFilter: { project: "alpha" },
      userId: "u-1",
      agentRole: "builder",
    });

    assert.equal(result.memory_id, "memory-1");
    assert.equal(result.session_id, "sess-fixed");
    assert.equal(result.trace_id, "trace-recall-ts");
    assert.equal(Array.isArray(result.results), true);
    assert.equal(result.results.length, 1);
  });

  assert.ok(captured.url.endsWith("/memories/memory-1/retrieve"));
  const headers = captured.init && captured.init.headers ? captured.init.headers : {};
  assert.equal(headers.Authorization, "Bearer test-key");

  const body = JSON.parse(captured.init.body);
  assert.ok(body.query.includes("Summarize latest auth changes"));
  assert.ok(body.query.includes("remaining todos, and blockers"));
  assert.equal(body.custom_kwargs.limit, 30);
  assert.equal(body.custom_kwargs.use_hybrid_search, false);
  assert.equal(body.custom_kwargs.use_mmr, true);
  assert.equal(body.custom_kwargs.mmr_lambda, 0.2);
  assert.equal(body.recall_mode, "hybrid");
  assert.equal(body.user_id, "u-1");
  assert.equal(body.agent_role, "builder");
  assert.equal(body.metadata_filter.project, "alpha");
  assert.deepEqual(body.metadata_filter.aw_content_scope, ["knowledge", "full_source"]);
});

test("retrieve defaults to precise and auto-extracts keyword query", async () => {
  const captured = { init: null };

  await withMockFetch(async (_url, init) => {
    captured.init = init;
    return jsonResponse({ results: [] }, { headers: { "X-Trace-Id": "trace-retrieve-ts" } });
  }, async () => {
    const client = new MemoryCloudClient({
      baseUrl: "http://localhost:8000/api/v1",
      apiKey: "test-key",
      maxRetries: 0,
      timeoutMs: 2000,
    });

    const result = await client.retrieve({
      memoryId: "memory-1",
      query: 'Check auth.py around "JWT" refresh flow',
    });

    assert.equal(result.trace_id, "trace-retrieve-ts");
  });

  const body = JSON.parse(captured.init.body);
  assert.equal(body.recall_mode, "precise");
  assert.equal(body.custom_kwargs.recall_mode, "precise");
  assert.match(body.keyword_query, /auth\.py/);
});

test("recallForTask defaults to hybrid", async () => {
  const captured = { init: null };

  await withMockFetch(async (_url, init) => {
    captured.init = init;
    return jsonResponse({ results: [] });
  }, async () => {
    const client = new MemoryCloudClient({
      baseUrl: "http://localhost:8000/api/v1",
      apiKey: "test-key",
      maxRetries: 0,
      timeoutMs: 2000,
    });

    await client.recallForTask({
      memoryId: "memory-1",
      task: "continue auth work",
    });
  });

  const body = JSON.parse(captured.init.body);
  assert.equal(body.recall_mode, "hybrid");
});

test("chatStream parses valid line-delimited JSON chunks", async () => {
  const captured = { streamFlag: null };

  await withMockFetch(async (_url, init) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"token","delta":"A"}\n{"type":"to'));
        controller.enqueue(encoder.encode('ken","delta":"B"}\nnot-json\n'));
        controller.close();
      },
    });
    const body = JSON.parse(init.body);
    captured.streamFlag = body.stream;
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Trace-Id": "trace-stream-ts" },
    });
  }, async () => {
    const client = new MemoryCloudClient({
      baseUrl: "http://localhost:8000/api/v1",
      apiKey: "test-key",
      maxRetries: 0,
      timeoutMs: 2000,
    });

    const events = [];
    await client.chatStream({
      memoryId: "memory-1",
      query: "continue",
      onEvent: (event) => events.push(event),
    });

    assert.equal(events.length, 2);
    assert.equal(events[0].delta, "A");
    assert.equal(events[1].delta, "B");
    assert.equal(events[0].trace_id, "trace-stream-ts");
    assert.equal(events[1].trace_id, "trace-stream-ts");
  });

  assert.equal(captured.streamFlag, true);
});
