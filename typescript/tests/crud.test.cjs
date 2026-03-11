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

function makeClient(overrides = {}) {
  return new MemoryCloudClient({
    baseUrl: "http://localhost:8000/api/v1",
    apiKey: "test-key",
    maxRetries: 0,
    timeoutMs: 2000,
    ...overrides,
  });
}

// ------------------------------------------------------------------
// Memory CRUD
// ------------------------------------------------------------------

test("createMemory sends POST /memories", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ id: "mem-1", name: "Test Memory" });
  }, async () => {
    const client = makeClient();
    const result = await client.createMemory({ name: "Test Memory", ownerId: "user-1" });
    assert.equal(result.id, "mem-1");
    assert.equal(result.name, "Test Memory");
  });

  assert.ok(captured.url.endsWith("/memories"));
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer test-key");
});

test("listMemories sends GET /memories", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse([{ id: "m1" }, { id: "m2" }]);
  }, async () => {
    const client = makeClient();
    const result = await client.listMemories();
    assert.equal(Array.isArray(result), true);
    assert.equal(result.length, 2);
  });

  assert.ok(captured.url.includes("/memories"));
});

test("getMemory sends GET /memories/:id", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse({ id: "mem-1", name: "My Memory" });
  }, async () => {
    const client = makeClient();
    const result = await client.getMemory({ memoryId: "mem-1" });
    assert.equal(result.name, "My Memory");
  });

  assert.ok(captured.url.includes("/memories/mem-1"));
});

test("updateMemory sends PATCH /memories/:id", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ id: "mem-1", name: "Updated" });
  }, async () => {
    const client = makeClient();
    const result = await client.updateMemory({ memoryId: "mem-1", payload: { name: "Updated" } });
    assert.equal(result.name, "Updated");
  });

  assert.ok(captured.url.includes("/memories/mem-1"));
  assert.equal(captured.init.method, "PATCH");
});

test("deleteMemory sends DELETE /memories/:id", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ deleted: true });
  }, async () => {
    const client = makeClient();
    const result = await client.deleteMemory({ memoryId: "mem-1" });
    assert.equal(result.deleted, true);
  });

  assert.ok(captured.url.includes("/memories/mem-1"));
  assert.equal(captured.init.method, "DELETE");
});

// ------------------------------------------------------------------
// Content Operations
// ------------------------------------------------------------------

test("listMemoryContent sends GET /memories/:id/content", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse([{ id: "c1", content: "hello" }]);
  }, async () => {
    const client = makeClient();
    const result = await client.listMemoryContent({ memoryId: "mem-1" });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "c1");
  });

  assert.ok(captured.url.includes("/memories/mem-1/content"));
});

test("write sends POST /memories/:id/content", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ status: "ok", id: "vec-1" });
  }, async () => {
    const client = makeClient();
    const result = await client.write({ memoryId: "mem-1", content: "important note" });
    assert.equal(result.status, "ok");
  });

  assert.ok(captured.url.includes("/memories/mem-1/content"));
  assert.equal(captured.init.method, "POST");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.content, "important note");
});

test("deleteMemoryContent sends DELETE /memories/:id/content/:contentId", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ deleted: true });
  }, async () => {
    const client = makeClient();
    const result = await client.deleteMemoryContent({ memoryId: "mem-1", contentId: "c-1" });
    assert.equal(result.deleted, true);
  });

  assert.ok(captured.url.includes("/content/c-1"));
  assert.equal(captured.init.method, "DELETE");
});

// ------------------------------------------------------------------
// Timeline
// ------------------------------------------------------------------

test("memoryTimeline sends GET /memories/:id/timeline", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse({ events: [{ type: "message" }], total: 1 });
  }, async () => {
    const client = makeClient();
    const result = await client.memoryTimeline({ memoryId: "mem-1" });
    assert.equal(result.total, 1);
  });

  assert.ok(captured.url.includes("/timeline"));
});

// ------------------------------------------------------------------
// Ingest Events
// ------------------------------------------------------------------

test("ingestEvents sends POST /memories/:id/mcp/events", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ ingested: 3 });
  }, async () => {
    const client = makeClient();
    const events = [
      { content: "msg1", event_type: "message" },
      { content: "msg2", event_type: "decision" },
      { content: "msg3", event_type: "tool_call" },
    ];
    const result = await client.ingestEvents({ memoryId: "mem-1", events });
    assert.equal(result.ingested, 3);
  });

  assert.equal(captured.init.method, "POST");
});

// ------------------------------------------------------------------
// Session Management
// ------------------------------------------------------------------

test("beginMemorySession returns local session info", () => {
  // beginMemorySession is synchronous and generates session IDs locally
  const client = makeClient();
  const result = client.beginMemorySession({ memoryId: "mem-1", source: "test-source" });

  assert.equal(result.memory_id, "mem-1");
  assert.equal(result.source, "test-source");
  assert.ok(result.session_id);
  assert.ok(typeof result.session_id === "string");
  assert.ok(result.session_id.length > 0);
});

test("beginMemorySession uses provided sessionId", () => {
  const client = makeClient();
  const result = client.beginMemorySession({ memoryId: "mem-1", sessionId: "my-session" });

  assert.equal(result.session_id, "my-session");
});

// ------------------------------------------------------------------
// Insights
// ------------------------------------------------------------------

test("insights sends POST /insights/memory", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({
      knowledge_cards: [{ title: "JWT auth" }],
      risks: [],
      action_items: [],
    });
  }, async () => {
    const client = makeClient();
    const result = await client.insights({ memoryId: "mem-1", query: "auth" });
    assert.equal(result.knowledge_cards.length, 1);
  });

  assert.ok(captured.url.includes("/insights/memory"));
});

// ------------------------------------------------------------------
// Context & Knowledge
// ------------------------------------------------------------------

test("getSessionContext sends GET /memories/:id/context", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse({
      memory_id: "mem-1",
      recent_days: [],
      open_tasks: [],
      knowledge_cards: [],
    });
  }, async () => {
    const client = makeClient();
    const result = await client.getSessionContext({ memoryId: "mem-1" });
    assert.equal(result.memory_id, "mem-1");
  });

  assert.ok(captured.url.includes("/context"));
});

test("getKnowledgeBase sends GET /memories/:id/knowledge", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse({ total: 5, cards: [{ title: "card1" }] });
  }, async () => {
    const client = makeClient();
    const result = await client.getKnowledgeBase({ memoryId: "mem-1" });
    // getKnowledgeBase returns what the server sends
    assert.ok(result.total === 5 || result.cards);
  });
});

// ------------------------------------------------------------------
// Retrieve advanced params
// ------------------------------------------------------------------

test("retrieve with multi_level and cluster_expand", async () => {
  const captured = { init: null };

  await withMockFetch(async (_url, init) => {
    captured.init = init;
    return jsonResponse({ results: [] });
  }, async () => {
    const client = makeClient();
    await client.retrieve({
      memoryId: "m1",
      query: "auth flow",
      multiLevel: true,
      clusterExpand: true,
      includeInstalled: true,
    });
  });

  const body = JSON.parse(captured.init.body);
  assert.equal(body.multi_level, true);
  assert.equal(body.cluster_expand, true);
  assert.equal(body.include_installed, true);
});

test("retrieve with userId and agentRole", async () => {
  const captured = { init: null };

  await withMockFetch(async (_url, init) => {
    captured.init = init;
    return jsonResponse({ results: [] });
  }, async () => {
    const client = makeClient();
    await client.retrieve({
      memoryId: "m1",
      query: "test",
      userId: "u-1",
      agentRole: "builder",
    });
  });

  const body = JSON.parse(captured.init.body);
  assert.equal(body.user_id, "u-1");
  assert.equal(body.agent_role, "builder");
});

// ------------------------------------------------------------------
// Retry logic
// ------------------------------------------------------------------

test("retries on 429 and succeeds", async () => {
  let callCount = 0;

  await withMockFetch(async () => {
    callCount++;
    if (callCount === 1) {
      return new Response("rate limited", { status: 429, headers: { "Content-Type": "text/plain" } });
    }
    return jsonResponse({ id: "mem-1", name: "OK" });
  }, async () => {
    const client = makeClient({ maxRetries: 2, retryDelayMs: 10 });
    const result = await client.getMemory({ memoryId: "mem-1" });
    assert.equal(result.name, "OK");
  });

  assert.equal(callCount, 2);
});

test("does not retry on 400", async () => {
  let callCount = 0;

  await withMockFetch(async () => {
    callCount++;
    return jsonResponse({ error: "bad request" }, { status: 400 });
  }, async () => {
    const client = makeClient({ maxRetries: 2, retryDelayMs: 10 });
    try {
      await client.getMemory({ memoryId: "mem-1" });
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err);
    }
  });

  assert.equal(callCount, 1);
});
