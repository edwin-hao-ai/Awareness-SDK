const test = require("node:test");
const assert = require("node:assert/strict");
const { MemoryCloudClient } = require("../dist/index.js");

function jsonResponse(payload, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  return new Response(JSON.stringify(payload), {
    status: options.status || 200,
    headers,
  });
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

test("retrieveWithHyde forwards hyde_hint from user LLM into POST body", async () => {
  const captured = { url: "", body: null, promptSeen: "" };

  const hypothetical =
    "JWT refresh tokens live for 30 days, rotate on every use, and are stored hashed in the users.refresh_token_hash column.";

  const llmComplete = async (prompt) => {
    captured.promptSeen = prompt;
    return hypothetical;
  };

  await withMockFetch(
    async (url, init) => {
      captured.url = String(url);
      captured.body = JSON.parse(init.body);
      return jsonResponse({ results: [{ content: "hit" }] });
    },
    async () => {
      const client = new MemoryCloudClient({
        baseUrl: "http://localhost:8000/api/v1",
        apiKey: "test-key",
        maxRetries: 0,
        timeoutMs: 2000,
      });

      const out = await client.retrieveWithHyde(
        {
          memoryId: "memory-1",
          query: "How long do refresh tokens live?",
          limit: 5,
        },
        llmComplete,
      );

      assert.equal(Array.isArray(out.results), true);
      assert.equal(out.results.length, 1);
    },
  );

  assert.ok(captured.url.endsWith("/memories/memory-1/retrieve"));
  assert.ok(captured.promptSeen.includes("How long do refresh tokens live?"));
  assert.ok(
    captured.promptSeen.includes("hypothetical answer"),
    "prompt should describe HyDE task",
  );
  assert.equal(
    captured.body.hyde_hint,
    hypothetical,
    "body should carry the generated hypothetical answer trimmed",
  );
  assert.equal(
    captured.body.query,
    "How long do refresh tokens live?",
    "raw query is preserved alongside hint",
  );
});

test("retrieveWithHyde falls back gracefully when llmComplete throws", async () => {
  const captured = { body: null };

  const llmComplete = async () => {
    throw new Error("LLM provider down");
  };

  await withMockFetch(
    async (_url, init) => {
      captured.body = JSON.parse(init.body);
      return jsonResponse({ results: [] });
    },
    async () => {
      const client = new MemoryCloudClient({
        baseUrl: "http://localhost:8000/api/v1",
        apiKey: "test-key",
        maxRetries: 0,
        timeoutMs: 2000,
      });

      const out = await client.retrieveWithHyde(
        {
          memoryId: "memory-2",
          query: "fallback query",
        },
        llmComplete,
      );

      assert.equal(Array.isArray(out.results), true);
    },
  );

  assert.equal(
    captured.body.hyde_hint,
    undefined,
    "no hyde_hint should be sent when LLM errors",
  );
  assert.equal(captured.body.query, "fallback query");
});

test("retrieveWithHyde drops too-short LLM output", async () => {
  const captured = { body: null };

  const llmComplete = async () => "too short"; // 9 chars < 20

  await withMockFetch(
    async (_url, init) => {
      captured.body = JSON.parse(init.body);
      return jsonResponse({ results: [] });
    },
    async () => {
      const client = new MemoryCloudClient({
        baseUrl: "http://localhost:8000/api/v1",
        apiKey: "test-key",
        maxRetries: 0,
        timeoutMs: 2000,
      });

      await client.retrieveWithHyde(
        {
          memoryId: "memory-3",
          query: "short-output query",
        },
        llmComplete,
      );
    },
  );

  assert.equal(
    captured.body.hyde_hint,
    undefined,
    "output under 20 chars should be dropped",
  );
});

test("retrieveWithHyde clamps long LLM output to 400 chars", async () => {
  const captured = { body: null };

  const longAnswer = "A".repeat(1200);
  const llmComplete = async () => longAnswer;

  await withMockFetch(
    async (_url, init) => {
      captured.body = JSON.parse(init.body);
      return jsonResponse({ results: [] });
    },
    async () => {
      const client = new MemoryCloudClient({
        baseUrl: "http://localhost:8000/api/v1",
        apiKey: "test-key",
        maxRetries: 0,
        timeoutMs: 2000,
      });

      await client.retrieveWithHyde(
        {
          memoryId: "memory-4",
          query: "clamp check",
        },
        llmComplete,
      );
    },
  );

  assert.equal(typeof captured.body.hyde_hint, "string");
  assert.equal(captured.body.hyde_hint.length, 400);
});

test("retrieve accepts explicit hydeHint option and forwards it", async () => {
  const captured = { body: null };

  await withMockFetch(
    async (_url, init) => {
      captured.body = JSON.parse(init.body);
      return jsonResponse({ results: [] });
    },
    async () => {
      const client = new MemoryCloudClient({
        baseUrl: "http://localhost:8000/api/v1",
        apiKey: "test-key",
        maxRetries: 0,
        timeoutMs: 2000,
      });

      await client.retrieve({
        memoryId: "memory-5",
        query: "explicit hint",
        hydeHint: "  A pre-computed hypothetical passage for the query.  ",
      });
    },
  );

  assert.equal(
    captured.body.hyde_hint,
    "A pre-computed hypothetical passage for the query.",
    "explicit hydeHint should be trimmed and forwarded as hyde_hint",
  );
});
