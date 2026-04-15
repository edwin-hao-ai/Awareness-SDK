const test = require("node:test");
const assert = require("node:assert/strict");
const { AwarenessInterceptor } = require("../dist/index.js");

test("runExtraction compacts events before LLM call and submits insights", async () => {
  const submitCalls = [];
  const fakeClient = {
    retrieve: async () => ({ results: [] }),
    rememberStep: async () => ({}),
    _submitInsights: async (input) => {
      submitCalls.push(input);
      return { accepted: true };
    },
  };

  const interceptor = await AwarenessInterceptor.create({
    client: fakeClient,
    memoryId: "memory-1",
    sessionId: "sess-main",
    userId: "u-1",
    agentRole: "sdk_demo",
    enableExtraction: true,
    extractionModel: "alibaba/qwen-3-14b",
  });

  let llmPayload = null;
  interceptor.callLLMForExtraction = async (_systemPrompt, userContent) => {
    llmPayload = JSON.parse(userContent);
    return JSON.stringify({
      knowledge_cards: [
        {
          title: "Use Redis Streams",
          summary: "Queue webhook side effects with idempotency keys.",
          category: "decision",
        },
      ],
      risks: [{ title: "Duplicate charge risk" }],
      action_items: [{ title: "Implement idempotency middleware" }],
    });
  };

  const events = Array.from({ length: 20 }).map((_, idx) => ({
    content: `event-${idx}-` + "x".repeat(700),
    event_type: "message",
    source: "sdk-ts-injected-demo",
  }));
  events.unshift({ content: "   " });

  await interceptor.runExtraction({
    memory_id: "memory-1",
    session_id: "sess-extract",
    events,
    existing_cards: [{ id: "card-1", title: "Old decision", summary: "Old summary", category: "decision" }],
    system_prompt: "Extract insights. Existing cards: {existing_cards}",
  });

  assert.ok(llmPayload);
  assert.equal(Array.isArray(llmPayload.events), true);
  assert.ok(llmPayload.events.length <= 12);
  const totalChars = llmPayload.events.reduce((acc, item) => acc + item.length, 0);
  assert.ok(totalChars <= 3600);
  for (const text of llmPayload.events) {
    assert.ok(text.length <= 480);
  }

  assert.equal(submitCalls.length, 1);
  assert.equal(submitCalls[0].memoryId, "memory-1");
  assert.equal(submitCalls[0].sessionId, "sess-extract");
  assert.equal(submitCalls[0].userId, "u-1");
  assert.equal(submitCalls[0].agentRole, "sdk_demo");
  assert.equal(submitCalls[0].insights.knowledge_cards.length, 1);
  assert.equal(submitCalls[0].insights.risks.length, 1);
  assert.equal(submitCalls[0].insights.action_items.length, 1);
});
