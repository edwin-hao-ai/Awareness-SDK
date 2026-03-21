/**
 * Functional (integration) tests for the TypeScript SDK.
 *
 * These tests call a real backend API and require:
 *   - A running backend at http://localhost:8000
 *   - RUN_LIVE_TESTS=1 environment variable
 *
 * Run: RUN_LIVE_TESTS=1 node --test tests/functional.test.cjs
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");

if (process.env.RUN_LIVE_TESTS !== "1") {
  console.log("Skipping live tests (set RUN_LIVE_TESTS=1 to enable)");
  process.exit(0);
}

const { MemoryCloudClient } = require("../dist/index.js");

const API_BASE_URL = process.env.AWARENESS_API_URL || "http://localhost:8000/api/v1";
const API_KEY = process.env.AWARENESS_API_KEY || "aw_-PycLiTUx-TjvVyZJ0iY6KJRFI8Yau8R";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("SDK Functional Tests (live API)", { timeout: 60000 }, () => {
  let client;
  let memoryId;
  const memoryName = `SDK TS Functional Test ${new Date().toISOString()}`;

  before(async () => {
    client = new MemoryCloudClient({
      baseUrl: API_BASE_URL,
      apiKey: API_KEY,
      timeoutMs: 30000,
      maxRetries: 2,
    });

    // Create a test memory
    const created = await client.createMemory({
      payload: {
        name: memoryName,
        custom_type: "universal",
        owner_id: "sdk-functest-user",
        config: { vector_dim: 768 },
      },
    });
    assert.ok(created, "createMemory should return a response");
    assert.ok(created.id, "createMemory should return an id");
    memoryId = created.id;
    console.log(`  Created test memory: ${memoryId}`);
  });

  after(async () => {
    if (memoryId && client) {
      try {
        await client.deleteMemory({ memoryId });
        console.log(`  Deleted test memory: ${memoryId}`);
      } catch (err) {
        console.warn(`  Failed to delete test memory ${memoryId}: ${err.message}`);
      }
    }
  });

  // ------------------------------------------------------------------
  // Memory CRUD
  // ------------------------------------------------------------------

  test("listMemories — returns an array", { timeout: 30000 }, async () => {
    const result = await client.listMemories({ ownerId: "sdk-functest-user" });
    assert.ok(Array.isArray(result), "listMemories should return an array");
    assert.ok(result.length > 0, "should have at least the test memory");
  });

  test("getMemory — returns an object with id", { timeout: 30000 }, async () => {
    const result = await client.getMemory({ memoryId });
    assert.ok(result, "getMemory should return a response");
    assert.equal(result.id, memoryId, "returned id should match");
    assert.ok(result.name, "should have a name field");
  });

  test("updateMemory — modifies name", { timeout: 30000 }, async () => {
    const newName = `${memoryName} (updated)`;
    const result = await client.updateMemory({
      memoryId,
      payload: { name: newName },
    });
    assert.ok(result, "updateMemory should return a response");
    assert.equal(result.name, newName, "name should be updated");
  });

  // ------------------------------------------------------------------
  // Record content
  // ------------------------------------------------------------------

  test("record string content — scope timeline", { timeout: 30000 }, async () => {
    const result = await client.record({
      memoryId,
      content: "User discussed authentication flow using JWT tokens for the new API gateway.",
      scope: "timeline",
    });
    assert.ok(result, "record should return a response");
    assert.equal(result.memory_id, memoryId, "memory_id should match");
    assert.ok(result.session_id, "should have session_id");
    assert.ok(result.ingest, "should have ingest result");
    assert.equal(result.events_count, 1, "should have 1 event");
  });

  test("record list content — scope timeline", { timeout: 30000 }, async () => {
    const result = await client.record({
      memoryId,
      content: [
        "Decided to use a vector database alongside relational storage for embeddings.",
        "Set up Redis for caching and task queue management.",
        "Configured async workers for the processing pipeline.",
      ],
      scope: "timeline",
    });
    assert.ok(result, "record should return a response");
    assert.equal(result.memory_id, memoryId);
    assert.equal(result.events_count, 3, "should have 3 events");
  });

  test("record dict knowledge — scope knowledge", { timeout: 30000 }, async () => {
    const result = await client.record({
      memoryId,
      content: {
        content: "Architecture decision: Use event sourcing pattern for audit trail with CQRS for read/write separation.",
        event_type: "decision",
        actor: "assistant",
      },
      scope: "knowledge",
    });
    assert.ok(result, "record should return a response");
    assert.equal(result.memory_id, memoryId);
    assert.equal(result.events_count, 1, "should have 1 event");
  });

  // ------------------------------------------------------------------
  // Content listing
  // ------------------------------------------------------------------

  test("listMemoryContent — returns content items", { timeout: 30000 }, async () => {
    const result = await client.listMemoryContent({ memoryId, limit: 50 });
    assert.ok(Array.isArray(result), "should return an array");
    // Content vectorization is async (background worker); may be empty if worker not running
    if (result.length > 0) {
      assert.ok(typeof result[0] === "object", "items should be objects");
    } else {
      console.log("    ⚠ listMemoryContent returned 0 items — background worker may not be running");
    }
  });

  // ------------------------------------------------------------------
  // Retrieval (needs vectorization time)
  // ------------------------------------------------------------------

  test("retrieve — semantic search", { timeout: 30000 }, async () => {
    // Wait for vectorization
    await sleep(3000);

    const result = await client.retrieve({
      memoryId,
      query: "authentication JWT tokens",
      limit: 5,
      recallMode: "precise",
    });
    assert.ok(result, "retrieve should return a response");
    assert.ok(Array.isArray(result.results), "should have results array");
  });

  test("recallForTask — task recall", { timeout: 30000 }, async () => {
    const result = await client.recallForTask({
      memoryId,
      task: "Review the authentication implementation",
      limit: 5,
    });
    assert.ok(result, "recallForTask should return a response");
    assert.equal(result.memory_id, memoryId, "memory_id should match");
    assert.ok(Array.isArray(result.results), "should have results array");
    assert.ok(result.session_id, "should have session_id");
  });

  // ------------------------------------------------------------------
  // Context / Knowledge / Tasks
  // ------------------------------------------------------------------

  test("getSessionContext — returns session context", { timeout: 30000 }, async () => {
    const result = await client.getSessionContext({ memoryId });
    assert.ok(result, "getSessionContext should return a response");
    assert.ok(result.memory_id || result.recent_days !== undefined, "should have context fields");
  });

  test("getKnowledgeBase — returns knowledge cards", { timeout: 30000 }, async () => {
    const result = await client.getKnowledgeBase({ memoryId });
    assert.ok(result, "getKnowledgeBase should return a response");
    assert.ok("total" in result, "should have total field");
    assert.ok(Array.isArray(result.cards), "should have cards array");
  });

  test("insights — returns insights", { timeout: 30000 }, async () => {
    const result = await client.insights({ memoryId });
    assert.ok(result, "insights should return a response");
    // The response structure may vary, just verify it's an object
    assert.equal(typeof result, "object", "should return an object");
  });

  test("memoryTimeline — returns timeline data", { timeout: 30000 }, async () => {
    const result = await client.memoryTimeline({ memoryId });
    assert.ok(result, "memoryTimeline should return a response");
    assert.equal(typeof result, "object", "should return an object");
  });

  test("getPendingTasks — returns tasks structure", { timeout: 30000 }, async () => {
    const result = await client.getPendingTasks({ memoryId });
    assert.ok(result, "getPendingTasks should return a response");
    assert.ok("total" in result, "should have total field");
    assert.ok(Array.isArray(result.tasks), "should have tasks array");
  });

  test("getHandoffContext — returns handoff briefing", { timeout: 30000 }, async () => {
    const result = await client.getHandoffContext({
      memoryId,
      currentTask: "Continue authentication implementation",
    });
    assert.ok(result, "getHandoffContext should return a response");
    assert.equal(result.memory_id, memoryId, "memory_id should match");
    assert.ok(result.briefing_for, "should have briefing_for");
    assert.ok(Array.isArray(result.recent_progress), "should have recent_progress array");
    assert.ok(Array.isArray(result.open_tasks), "should have open_tasks array");
    assert.ok(Array.isArray(result.key_knowledge), "should have key_knowledge array");
    assert.ok(typeof result.token_estimate === "number", "should have token_estimate");
  });

  // ------------------------------------------------------------------
  // Agent / Role detection
  // ------------------------------------------------------------------

  test("detectAgentRole — returns role detection result", { timeout: 30000 }, async () => {
    try {
      const result = await client.detectAgentRole({
        memoryId,
        content: "I need to debug the authentication middleware and fix the token validation logic.",
      });
      assert.ok(result, "detectAgentRole should return a response");
      assert.equal(typeof result, "object", "should return an object");
    } catch (err) {
      // 400/422 expected if memory has no agent_profiles configured
      assert.ok(
        [400, 422].includes(err.statusCode),
        `expected 400 or 422 for memory without agent_profiles, got ${err.statusCode}`
      );
    }
  });

  test("listAgents — returns agents list", { timeout: 30000 }, async () => {
    const result = await client.listAgents({ memoryId });
    assert.ok(result, "listAgents should return a response");
    assert.equal(typeof result, "object", "should return an object");
    // agents may be an empty array if none configured
    assert.ok(Array.isArray(result.agents), "should have agents array");
  });

  // ------------------------------------------------------------------
  // Users
  // ------------------------------------------------------------------

  test("getMemoryUsers — returns users list", { timeout: 30000 }, async () => {
    const result = await client.getMemoryUsers({ memoryId });
    assert.ok(result, "getMemoryUsers should return a response");
    assert.equal(typeof result, "object", "should return an object");
  });
});
