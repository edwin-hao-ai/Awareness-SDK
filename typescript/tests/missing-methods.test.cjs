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
// record
// ------------------------------------------------------------------

test("record sends POST with string content", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ ingested: 1, trace_id: "t-1" });
  }, async () => {
    const client = makeClient();
    const result = await client.record({ memoryId: "mem-1", content: "hello world" });
    assert.equal(result.memory_id, "mem-1");
    assert.equal(result.events_count, 1);
  });

  assert.ok(captured.url.includes("/mcp/events"));
  assert.equal(captured.init.method, "POST");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.memory_id, "mem-1");
  assert.ok(Array.isArray(body.events));
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].content, "hello world");
});

test("record sends POST with list content", async () => {
  const captured = { init: null };

  await withMockFetch(async (_url, init) => {
    captured.init = init;
    return jsonResponse({ ingested: 2, trace_id: "t-2" });
  }, async () => {
    const client = makeClient();
    const result = await client.record({
      memoryId: "mem-1",
      content: ["step one done", "step two done"],
    });
    assert.equal(result.events_count, 2);
  });

  const body = JSON.parse(captured.init.body);
  assert.equal(body.events.length, 2);
  assert.equal(body.events[0].content, "step one done");
  assert.equal(body.events[1].content, "step two done");
});

test("record with insights and scope and userId", async () => {
  const calls = [];

  await withMockFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ ingested: 1, trace_id: "t-3" });
  }, async () => {
    const client = makeClient();
    const result = await client.record({
      memoryId: "mem-1",
      content: "decided to use JWT tokens",
      insights: {
        knowledge_cards: [{ title: "Auth decision", summary: "Use JWT" }],
        risks: [],
        action_items: [],
      },
      scope: "knowledge",
      userId: "alice",
      agentRole: "architect",
    });
    assert.equal(result.memory_id, "mem-1");
    assert.ok(result.insights);
  });

  // First call: ingest events; second call: submit insights
  assert.equal(calls.length, 2);
  const ingestBody = JSON.parse(calls[0].init.body);
  assert.equal(ingestBody.user_id, "alice");
  assert.deepEqual(ingestBody.metadata_defaults, { aw_content_scope: "knowledge" });

  const insightsBody = JSON.parse(calls[1].init.body);
  assert.ok(calls[1].url.includes("/insights/submit"));
  assert.ok(Array.isArray(insightsBody.knowledge_cards));
  assert.equal(insightsBody.user_id, "alice");
  assert.equal(insightsBody.agent_role, "architect");
});

// ------------------------------------------------------------------
// chat
// ------------------------------------------------------------------

test("chat sends POST with query", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ answer: "42", sources: [] });
  }, async () => {
    const client = makeClient();
    const result = await client.chat({ memoryId: "mem-1", query: "what is the meaning?" });
    assert.equal(result.answer, "42");
  });

  assert.ok(captured.url.includes("/memories/mem-1/chat"));
  assert.equal(captured.init.method, "POST");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.query, "what is the meaning?");
  assert.equal(body.stream, false);
});

test("chat with all params", async () => {
  const captured = { init: null };

  await withMockFetch(async (_url, init) => {
    captured.init = init;
    return jsonResponse({ answer: "detailed" });
  }, async () => {
    const client = makeClient();
    await client.chat({
      memoryId: "mem-1",
      query: "explain auth",
      model: "gpt-4o",
      sessionId: "sess-1",
      metadataFilter: { agent_role: "builder" },
      contextBudgetTokens: 4000,
    });
  });

  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "gpt-4o");
  assert.equal(body.session_id, "sess-1");
  assert.deepEqual(body.metadata_filter, { agent_role: "builder" });
  assert.equal(body.context_budget_tokens, 4000);
});

// ------------------------------------------------------------------
// Task / Context
// ------------------------------------------------------------------

test("getPendingTasks sends GET with params", async () => {
  const calls = [];

  await withMockFetch(async (url) => {
    calls.push(String(url));
    return jsonResponse({ action_items: [{ id: "t-1", title: "Fix bug", priority: "high", status: "pending" }] });
  }, async () => {
    const client = makeClient();
    const result = await client.getPendingTasks({
      memoryId: "mem-1",
      priority: "high",
      userId: "alice",
    });
    assert.ok(result.total >= 0);
    assert.ok(Array.isArray(result.tasks));
  });

  // getPendingTasks fires two parallel requests (pending + in_progress)
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("/action-items"));
  assert.ok(calls[0].includes("priority=high"));
  assert.ok(calls[0].includes("user_id=alice"));
});

test("getHandoffContext sends GET", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse({
      memory_id: "mem-1",
      recent_days: [{ date: "2026-03-19", narrative: "Did some work" }],
      open_tasks: [{ title: "Deploy", priority: "high", status: "pending" }],
      knowledge_cards: [{ title: "JWT", summary: "Use tokens" }],
    });
  }, async () => {
    const client = makeClient();
    const result = await client.getHandoffContext({ memoryId: "mem-1", currentTask: "Resume deploy" });
    assert.equal(result.memory_id, "mem-1");
    assert.equal(result.briefing_for, "Resume deploy");
    assert.ok(Array.isArray(result.recent_progress));
    assert.ok(Array.isArray(result.open_tasks));
    assert.ok(Array.isArray(result.key_knowledge));
    assert.ok(result.token_estimate > 0);
  });

  assert.ok(captured.url.includes("/context"));
});

test("getSessionHistory sends GET", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse([
      { content: "event1", aw_time_iso: "2026-03-19T10:00:00Z" },
      { content: "event2", aw_time_iso: "2026-03-19T11:00:00Z" },
    ]);
  }, async () => {
    const client = makeClient();
    const result = await client.getSessionHistory({
      memoryId: "mem-1",
      sessionId: "sess-abc",
      limit: 50,
      userId: "bob",
    });
    assert.equal(result.memory_id, "mem-1");
    assert.equal(result.session_id, "sess-abc");
    assert.equal(result.event_count, 2);
    assert.ok(Array.isArray(result.events));
  });

  assert.ok(captured.url.includes("/memories/mem-1/content"));
  assert.ok(captured.url.includes("session_id=sess-abc"));
  assert.ok(captured.url.includes("user_id=bob"));
  assert.ok(captured.url.includes("limit=50"));
});

test("updateTaskStatus sends PATCH", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ id: "task-1", status: "completed" });
  }, async () => {
    const client = makeClient();
    const result = await client.updateTaskStatus({
      memoryId: "mem-1",
      taskId: "task-1",
      status: "completed",
    });
    assert.equal(result.status, "completed");
  });

  assert.ok(captured.url.includes("/action-items/task-1"));
  assert.equal(captured.init.method, "PATCH");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.status, "completed");
});

// ------------------------------------------------------------------
// Agent / User
// ------------------------------------------------------------------

test("detectAgentRole sends POST", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ agent_role: "builder", confidence: 0.92 });
  }, async () => {
    const client = makeClient();
    const result = await client.detectAgentRole({
      memoryId: "mem-1",
      content: "I am refactoring the auth module",
    });
    assert.equal(result.agent_role, "builder");
  });

  assert.ok(captured.url.includes("/memories/mem-1/detect-role"));
  assert.equal(captured.init.method, "POST");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.content, "I am refactoring the auth module");
});

test("listAgents sends GET", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse({
      agents: [
        { agent_role: "builder", system_prompt: "You are a builder", activation_prompt: "Build things" },
        { agent_role: "reviewer", system_prompt: "You are a reviewer", activation_prompt: "Review code" },
      ],
    });
  }, async () => {
    const client = makeClient();
    const result = await client.listAgents({ memoryId: "mem-1" });
    assert.equal(result.agents.length, 2);
    assert.equal(result.agents[0].agent_role, "builder");
  });

  assert.ok(captured.url.includes("/memories/mem-1/agents"));
});

test("getAgentPrompt sends GET", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse({
      agents: [
        { agent_role: "builder", activation_prompt: "Build things" },
        { agent_role: "reviewer", activation_prompt: "Review code" },
      ],
    });
  }, async () => {
    const client = makeClient();
    const prompt = await client.getAgentPrompt({ memoryId: "mem-1", agentRole: "reviewer" });
    assert.equal(prompt, "Review code");
  });

  assert.ok(captured.url.includes("/memories/mem-1/agents"));
});

test("getMemoryUsers sends GET with pagination", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse({ users: ["alice", "bob"], total: 2 });
  }, async () => {
    const client = makeClient();
    const result = await client.getMemoryUsers({ memoryId: "mem-1", limit: 10, offset: 5 });
    assert.ok(result.users);
    assert.equal(result.total, 2);
  });

  assert.ok(captured.url.includes("/memories/mem-1/users"));
  assert.ok(captured.url.includes("limit=10"));
  assert.ok(captured.url.includes("offset=5"));
});

// ------------------------------------------------------------------
// Upload / Export
// ------------------------------------------------------------------

test("uploadFile sends POST multipart", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ job_id: "upload-1", status: "processing" });
  }, async () => {
    const client = makeClient();
    const fileBlob = new Blob(["file content"], { type: "text/plain" });
    const result = await client.uploadFile({
      memoryId: "mem-1",
      file: fileBlob,
      filename: "notes.txt",
    });
    assert.equal(result.job_id, "upload-1");
  });

  assert.ok(captured.url.includes("/memories/mem-1/upload_file"));
  assert.equal(captured.init.method, "POST");
  // FormData body — Content-Type should NOT be manually set to application/json
  assert.ok(!captured.init.headers["Content-Type"] || !captured.init.headers["Content-Type"].includes("application/json"));
});

test("exportMemoryPackage sends POST", async () => {
  const captured = { url: "", init: null };
  const zipBytes = new Uint8Array([80, 75, 3, 4]); // PK zip header

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return new Response(zipBytes.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="memory_export.zip"',
      },
    });
  }, async () => {
    const client = makeClient();
    const result = await client.exportMemoryPackage({
      memoryId: "mem-1",
      payload: { package_type: "full" },
    });
    assert.equal(result.filename, "memory_export.zip");
    assert.equal(result.contentType, "application/zip");
    assert.ok(result.bytes instanceof Uint8Array);
  });

  assert.ok(captured.url.includes("/memories/mem-1/export"));
  assert.equal(captured.init.method, "POST");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.package_type, "full");
});

test("getAsyncJobStatus sends GET", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse({ job_id: "job-42", status: "completed", result: { items: 10 } });
  }, async () => {
    const client = makeClient();
    const result = await client.getAsyncJobStatus({ jobId: "job-42" });
    assert.equal(result.job_id, "job-42");
    assert.equal(result.status, "completed");
  });

  assert.ok(captured.url.includes("/jobs/job-42"));
});

// ------------------------------------------------------------------
// API Keys
// ------------------------------------------------------------------

test("createApiKey sends POST", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ id: "key-1", key: "ak_xxx", name: "My Key" });
  }, async () => {
    const client = makeClient();
    const result = await client.createApiKey({ ownerId: "user-1", name: "My Key" });
    assert.equal(result.id, "key-1");
    assert.equal(result.name, "My Key");
  });

  assert.ok(captured.url.includes("/apikeys"));
  assert.equal(captured.init.method, "POST");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.owner_id, "user-1");
  assert.equal(body.name, "My Key");
});

test("listApiKeys sends GET", async () => {
  const captured = { url: "" };

  await withMockFetch(async (url) => {
    captured.url = String(url);
    return jsonResponse([{ id: "key-1", name: "Default Key" }, { id: "key-2", name: "CI Key" }]);
  }, async () => {
    const client = makeClient();
    const result = await client.listApiKeys({ ownerId: "user-1" });
    assert.equal(Array.isArray(result), true);
    assert.equal(result.length, 2);
  });

  assert.ok(captured.url.includes("/apikeys"));
  assert.ok(captured.url.includes("owner_id=user-1"));
});

test("memoryWizard sends POST", async () => {
  const captured = { url: "", init: null };

  await withMockFetch(async (url, init) => {
    captured.url = String(url);
    captured.init = init;
    return jsonResponse({ reply: "How about a coding assistant?", draft: { name: "CodeBot" } });
  }, async () => {
    const client = makeClient();
    const result = await client.memoryWizard({
      ownerId: "user-1",
      messages: [{ role: "user", content: "I want a memory for coding" }],
      draft: { name: "" },
      locale: "zh",
    });
    assert.equal(result.reply, "How about a coding assistant?");
  });

  assert.ok(captured.url.includes("/wizard/memory_designer"));
  assert.equal(captured.init.method, "POST");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.owner_id, "user-1");
  assert.equal(body.locale, "zh");
  assert.ok(Array.isArray(body.messages));
  assert.equal(body.messages[0].role, "user");
});
