const test = require("node:test");
const assert = require("node:assert/strict");
const { AwarenessInterceptor } = require("../dist/index.js");

function makeFakeClient() {
  return {
    retrieve: async () => ({
      results: [
        { content: "JWT auth decision", id: "v1", score: 0.9 },
        { content: "Redis session store", id: "v2", score: 0.8 },
      ],
    }),
    rememberStep: async () => ({ status: "ok", event_id: "e1" }),
    submitInsights: async () => ({ accepted: true }),
    beginMemorySession: async () => ({ session_id: "sess-test" }),
    getAgentPrompt: async () => ({ prompt: "You are a helpful assistant." }),
    recallForTask: async () => ({
      results: [{ content: "context" }],
      memory_id: "mem-1",
      session_id: "sess-test",
    }),
  };
}

// ------------------------------------------------------------------
// Interceptor creation
// ------------------------------------------------------------------

test("AwarenessInterceptor.create initializes correctly", async () => {
  const interceptor = await AwarenessInterceptor.create({
    client: makeFakeClient(),
    memoryId: "mem-1",
    sessionId: "sess-fixed",
    userId: "u-1",
    agentRole: "builder",
  });

  assert.equal(interceptor.memoryId, "mem-1");
  assert.equal(interceptor.sessionId, "sess-fixed");
  assert.equal(interceptor.userId, "u-1");
  assert.equal(interceptor.agentRole, "builder");
});

test("AwarenessInterceptor.create auto-generates sessionId when not provided", async () => {
  const interceptor = await AwarenessInterceptor.create({
    client: makeFakeClient(),
    memoryId: "mem-1",
  });

  assert.ok(interceptor.sessionId);
  assert.ok(interceptor.sessionId.length > 0);
});

// ------------------------------------------------------------------
// wrapOpenAI
// ------------------------------------------------------------------

test("wrapOpenAI patches the create method", async () => {
  const interceptor = await AwarenessInterceptor.create({
    client: makeFakeClient(),
    memoryId: "mem-1",
    sessionId: "sess-test",
  });

  const oai = {
    chat: {
      completions: {
        create: async (opts) => ({
          choices: [{ message: { content: "original response" } }],
        }),
      },
    },
  };

  const originalCreate = oai.chat.completions.create;
  interceptor.wrapOpenAI(oai);

  // create should be replaced
  assert.notEqual(oai.chat.completions.create, originalCreate);
});

test("wrapOpenAI injects memory context and passes through response", async () => {
  const client = makeFakeClient();
  let retrieveCalled = false;
  client.retrieve = async () => {
    retrieveCalled = true;
    return { results: [{ content: "Memory: use JWT auth" }] };
  };

  const interceptor = await AwarenessInterceptor.create({
    client,
    memoryId: "mem-1",
    sessionId: "sess-test",
  });

  let capturedMessages = null;
  const oai = {
    chat: {
      completions: {
        create: async (opts) => {
          capturedMessages = opts.messages;
          return {
            choices: [{ message: { content: "Response with memory" } }],
          };
        },
      },
    },
  };

  interceptor.wrapOpenAI(oai);

  const result = await oai.chat.completions.create({
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "What auth do we use?" },
    ],
    model: "gpt-4o",
  });

  assert.ok(retrieveCalled, "retrieve should have been called for context");
  assert.equal(result.choices[0].message.content, "Response with memory");

  // System message should contain injected memory
  const systemMsg = capturedMessages.find((m) => m.role === "system");
  assert.ok(systemMsg);
  assert.ok(systemMsg.content.includes("JWT auth") || systemMsg.content.includes("[Relevant memories]"));
});

// ------------------------------------------------------------------
// wrapAnthropic
// ------------------------------------------------------------------

test("wrapAnthropic patches the create method", async () => {
  const interceptor = await AwarenessInterceptor.create({
    client: makeFakeClient(),
    memoryId: "mem-1",
    sessionId: "sess-test",
  });

  const ant = {
    messages: {
      create: async (opts) => ({
        content: [{ type: "text", text: "original" }],
      }),
    },
  };

  const originalCreate = ant.messages.create;
  interceptor.wrapAnthropic(ant);
  assert.notEqual(ant.messages.create, originalCreate);
});

test("wrapAnthropic injects memory and passes through response", async () => {
  const client = makeFakeClient();
  let retrieveCalled = false;
  client.retrieve = async () => {
    retrieveCalled = true;
    return { results: [{ content: "Memory: Redis is session store" }] };
  };

  const interceptor = await AwarenessInterceptor.create({
    client,
    memoryId: "mem-1",
    sessionId: "sess-test",
  });

  let capturedOpts = null;
  const ant = {
    messages: {
      create: async (opts) => {
        capturedOpts = opts;
        return {
          content: [{ type: "text", text: "Anthropic reply" }],
        };
      },
    },
  };

  interceptor.wrapAnthropic(ant);

  const result = await ant.messages.create({
    messages: [{ role: "user", content: "What session store?" }],
    model: "claude-sonnet-4-6",
  });

  assert.ok(retrieveCalled, "retrieve should have been called");
  assert.equal(result.content[0].text, "Anthropic reply");
});

// ------------------------------------------------------------------
// registerFunction
// ------------------------------------------------------------------

test("registerFunction wraps a generic LLM function", async () => {
  const interceptor = await AwarenessInterceptor.create({
    client: makeFakeClient(),
    memoryId: "mem-1",
    sessionId: "sess-test",
  });

  let capturedArgs = null;
  const originalFn = async (opts) => {
    capturedArgs = opts;
    return { choices: [{ message: { content: "generic reply" } }] };
  };

  const wrapped = interceptor.registerFunction(originalFn);
  assert.notEqual(wrapped, originalFn);

  const result = await wrapped({
    messages: [{ role: "user", content: "Hello" }],
    model: "gpt-4",
  });

  // Should have been called with messages (possibly augmented)
  assert.ok(capturedArgs);
  assert.ok(capturedArgs.messages);
});

// ------------------------------------------------------------------
// Memory injection content validation
// ------------------------------------------------------------------

test("injected memory contains relevant context from retrieve", async () => {
  const client = makeFakeClient();
  client.retrieve = async () => ({
    results: [
      { content: "Decision: use PostgreSQL as primary DB" },
      { content: "Risk: migration complexity" },
    ],
  });

  const interceptor = await AwarenessInterceptor.create({
    client,
    memoryId: "mem-1",
    sessionId: "sess-test",
  });

  let capturedMessages = null;
  const oai = {
    chat: {
      completions: {
        create: async (opts) => {
          capturedMessages = opts.messages;
          return { choices: [{ message: { content: "OK" } }] };
        },
      },
    },
  };

  interceptor.wrapOpenAI(oai);

  await oai.chat.completions.create({
    messages: [
      { role: "user", content: "What database?" },
    ],
    model: "gpt-4o",
  });

  // Verify memory was injected into messages
  const allContent = capturedMessages.map((m) => m.content).join(" ");
  assert.ok(
    allContent.includes("PostgreSQL") || allContent.includes("[Relevant memories]"),
    "Memory context should be injected"
  );
});

// ------------------------------------------------------------------
// Error resilience
// ------------------------------------------------------------------

test("wrapOpenAI still works when retrieve fails", async () => {
  const client = makeFakeClient();
  client.retrieve = async () => {
    throw new Error("Network error");
  };

  const interceptor = await AwarenessInterceptor.create({
    client,
    memoryId: "mem-1",
    sessionId: "sess-test",
  });

  const oai = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "Still works" } }],
        }),
      },
    },
  };

  interceptor.wrapOpenAI(oai);

  // Should not throw even though retrieve failed
  const result = await oai.chat.completions.create({
    messages: [{ role: "user", content: "Hello" }],
    model: "gpt-4o",
  });
  assert.equal(result.choices[0].message.content, "Still works");
});

test("wrapAnthropic still works when retrieve fails", async () => {
  const client = makeFakeClient();
  client.retrieve = async () => {
    throw new Error("Network error");
  };

  const interceptor = await AwarenessInterceptor.create({
    client,
    memoryId: "mem-1",
    sessionId: "sess-test",
  });

  const ant = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "Still works" }],
      }),
    },
  };

  interceptor.wrapAnthropic(ant);

  const result = await ant.messages.create({
    messages: [{ role: "user", content: "Hello" }],
    model: "claude-sonnet-4-6",
  });
  assert.equal(result.content[0].text, "Still works");
});
