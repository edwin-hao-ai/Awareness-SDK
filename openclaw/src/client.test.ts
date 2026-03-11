import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AwarenessClient, SearchOptions } from "./client";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function makeClient(opts?: { agentRole?: string }) {
  return new AwarenessClient(
    "https://awareness.market/api/v1",
    "test-api-key-123",
    "mem-test-001",
    opts?.agentRole ?? "builder_agent",
  );
}

// ===========================================================================
// Dimension 1: Feature Alignment — client method coverage
// ===========================================================================

describe("AwarenessClient", () => {
  describe("constructor", () => {
    it("generates a unique session ID", () => {
      const c1 = makeClient();
      const c2 = makeClient();
      expect(c1.sessionId).toMatch(/^openclaw-/);
      expect(c1.sessionId).not.toBe(c2.sessionId);
    });

    it("strips trailing slash from baseUrl", () => {
      const client = new AwarenessClient(
        "https://api.example.com/v1/",
        "key",
        "mem-1",
      );
      // We verify by checking a GET call URL
      mockFetch.mockReturnValueOnce(jsonResponse({}));
      client.get("/test");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/v1/test",
        expect.anything(),
      );
    });
  });

  // =========================================================================
  // TEST-ALIGN-01: Init returns session_id + context
  // =========================================================================
  describe("init()", () => {
    it("returns session_id and context from /memories/{id}/context", async () => {
      const contextData = {
        memory_id: "mem-test-001",
        recent_days: [{ date: "2026-03-10", narrative: "Built auth module" }],
        open_tasks: [{ title: "Add tests", priority: "high", status: "pending" }],
        knowledge_cards: [{ title: "JWT Auth", category: "decision", summary: "Using JWT" }],
      };
      mockFetch.mockReturnValueOnce(jsonResponse(contextData));

      const client = makeClient();
      const result = await client.init(7, 20, 20);

      expect(result.session_id).toMatch(/^openclaw-/);
      expect(result.context.recent_days).toHaveLength(1);
      expect(result.context.open_tasks).toHaveLength(1);
      expect(result.context.knowledge_cards).toHaveLength(1);

      // Verify the GET request
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/memories/mem-test-001/context");
      expect(url).toContain("days=7");
      expect(url).toContain("max_cards=20");
      expect(url).toContain("max_tasks=20");
      expect(url).toContain("agent_role=builder_agent");
    });

    it("works with no arguments (defaults)", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ memory_id: "mem-test-001" }));
      const result = await makeClient().init();
      expect(result.session_id).toBeTruthy();
      expect(result.context).toBeDefined();
    });
  });

  // =========================================================================
  // TEST-ALIGN-02 to 05: Recall with various options
  // =========================================================================
  describe("search()", () => {
    it("sends semantic_query with vector search params", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          results: [{ content: "JWT auth decision", score: 0.92 }],
        }),
      );

      const client = makeClient();
      const result = await client.search({ semanticQuery: "auth method" });

      expect(result.results).toHaveLength(1);
      expect(result.results![0].score).toBe(0.92);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.query).toContain("auth method");
      expect(body.custom_kwargs.use_hybrid_search).toBe(true);
      expect(body.custom_kwargs.reconstruct_chunks).toBe(true);
      expect(body.custom_kwargs.recall_mode).toBe("auto");
      expect(body.agent_role).toBe("builder_agent");
    });

    it("passes keyword_query for full-text matching", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "auth decision",
        keywordQuery: "JWT PyJWT python-jose",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.keyword_query).toBe("JWT PyJWT python-jose");
    });

    it("applies scope filter via metadata_filter", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        scope: "knowledge",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.metadata_filter).toEqual({
        aw_content_scope: ["knowledge", "full_source"],
      });
    });

    it("scope=timeline maps correctly", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        scope: "timeline",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.metadata_filter.aw_content_scope).toEqual(["timeline"]);
    });

    it("scope=all does not add metadata_filter", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        scope: "all",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.metadata_filter).toBeUndefined();
    });

    // TEST: recall_mode structured
    it("supports structured recall_mode", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        recallMode: "structured",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.recall_mode).toBe("structured");
    });

    // TEST: recall_mode hybrid
    it("supports hybrid recall_mode", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        recallMode: "hybrid",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.recall_mode).toBe("hybrid");
    });

    // TEST: multi_level broader context retrieval
    it("passes multi_level param", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        multiLevel: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.multi_level).toBe(true);
    });

    // TEST: cluster_expand topic-based expansion
    it("passes cluster_expand param", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        clusterExpand: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.cluster_expand).toBe(true);
    });

    // TEST: confidence_threshold
    it("passes confidence_threshold param", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        confidenceThreshold: 0.7,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.confidence_threshold).toBe(0.7);
    });

    // TEST: include_installed marketplace memories
    it("passes include_installed param", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        includeInstalled: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.include_installed).toBe(true);
    });

    // TEST: user_id filtering
    it("passes user_id for multi-user filtering", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      await makeClient().search({
        semanticQuery: "test",
        userId: "alice@novapay.com",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.user_id).toBe("alice@novapay.com");
    });

    it("clamps limit between 1 and 30", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));
      await makeClient().search({ semanticQuery: "test", limit: 50 });
      const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body1.custom_kwargs.limit).toBe(30);

      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));
      await makeClient().search({ semanticQuery: "test", limit: 0 });
      const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body2.custom_kwargs.limit).toBe(1);
    });
  });

  // =========================================================================
  // TEST-ALIGN-06 to 09: Lookup (getData)
  // =========================================================================
  describe("getData()", () => {
    it("type=context calls /memories/{id}/context", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ memory_id: "mem-test-001" }));
      const client = makeClient();
      await client.getData("context", { days: 14 });

      expect(mockFetch.mock.calls[0][0]).toContain("/memories/mem-test-001/context");
      expect(mockFetch.mock.calls[0][0]).toContain("days=14");
    });

    it("type=tasks calls /insights/action-items", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ action_items: [{ title: "Deploy", status: "pending" }] }),
      );

      const result = await makeClient().getData("tasks", { priority: "high" });
      expect(mockFetch.mock.calls[0][0]).toContain("/insights/action-items");
      expect(mockFetch.mock.calls[0][0]).toContain("priority=high");
    });

    it("type=knowledge calls /insights/knowledge-cards with filters", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ cards: [{ title: "JWT", category: "decision" }] }),
      );

      await makeClient().getData("knowledge", {
        query: "auth",
        category: "decision",
        limit: 10,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/insights/knowledge-cards");
      expect(url).toContain("query=auth");
      expect(url).toContain("category=decision");
      expect(url).toContain("limit=10");
    });

    it("type=risks calls /insights/risks with filters", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ risks: [{ title: "SQL injection", level: "high" }] }),
      );

      await makeClient().getData("risks", { level: "high" });
      expect(mockFetch.mock.calls[0][0]).toContain("/insights/risks");
      expect(mockFetch.mock.calls[0][0]).toContain("level=high");
    });

    it("type=session_history requires session_id", async () => {
      const result = await makeClient().getData("session_history", {});
      expect(result).toEqual({ error: "session_id is required for type='session_history'." });
    });

    it("type=session_history calls /content with session_id", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse([]));
      await makeClient().getData("session_history", { session_id: "sess-123" });
      expect(mockFetch.mock.calls[0][0]).toContain("/content");
      expect(mockFetch.mock.calls[0][0]).toContain("session_id=sess-123");
    });

    it("type=timeline calls /timeline", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ events: [] }));
      await makeClient().getData("timeline", { limit: 20, offset: 0 });
      expect(mockFetch.mock.calls[0][0]).toContain("/timeline");
    });

    it("type=handoff returns structured handoff context", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          recent_days: [{ date: "2026-03-10", narrative: "Auth work" }],
          open_tasks: [{ title: "Add tests", priority: "high", status: "pending" }],
          knowledge_cards: [{ title: "JWT", summary: "Using JWT for auth" }],
        }),
      );

      const result = (await makeClient().getData("handoff", { query: "Continue auth" })) as Record<
        string,
        unknown
      >;
      expect(result.briefing_for).toBe("Continue auth");
      expect(result.recent_progress).toHaveLength(1);
      expect(result.open_tasks).toHaveLength(1);
      expect(result.key_knowledge).toHaveLength(1);
    });

    it("type=unknown returns error", async () => {
      const result = await makeClient().getData("nonexistent");
      expect(result).toEqual({ error: "Unknown type: nonexistent" });
    });
  });

  // =========================================================================
  // TEST-ALIGN-10 to 15: Record (write)
  // =========================================================================
  describe("write()", () => {
    it("action=remember sends single event to /mcp/events", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 1, written: 1 }));

      const client = makeClient();
      const result = await client.write("remember", {
        text: "Decided to use JWT for authentication",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toBe("Decided to use JWT for authentication");
      expect(body.memory_id).toBe("mem-test-001");
      expect(body.session_id).toMatch(/^openclaw-/);
      expect(body.agent_role).toBe("builder_agent");
    });

    it("action=remember_batch sends steps to /mcp/events/batch", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 3, written: 3 }));

      await makeClient().write("remember_batch", {
        steps: [
          { text: "Step 1: Created auth module" },
          { text: "Step 2: Added JWT middleware" },
          { text: "Step 3: Wrote tests" },
        ],
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/mcp/events/batch");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.steps).toHaveLength(3);
    });

    it("action=update_task PATCHes task status", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ status: "completed" }));

      await makeClient().write("update_task", {
        task_id: "task-abc-123",
        status: "completed",
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/insights/action-items/task-abc-123");
      expect(mockFetch.mock.calls[0][1].method).toBe("PATCH");
    });

    it("action=submit_insights POSTs to /insights/submit", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ status: "ok" }));

      const insights = [
        { type: "knowledge_card", title: "JWT Auth", category: "decision" },
      ];
      await makeClient().write("submit_insights", { content: insights });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/insights/submit");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.insights).toEqual(insights);
    });

    it("action=backfill sends to /mcp/events/backfill", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 10, written: 10 }));

      const history = [
        { role: "user", content: "Build auth" },
        { role: "assistant", content: "I'll create the auth module..." },
      ];
      await makeClient().write("backfill", { history });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/mcp/events/backfill");
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.history).toEqual(history);
      expect(body.generate_summary).toBe(true);
    });

    it("action=ingest sends content to /mcp/events", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 5, written: 5 }));

      await makeClient().write("ingest", {
        content: "Design document content...",
        content_scope: "knowledge",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toBe("Design document content...");
      expect(body.content_scope).toBe("knowledge");
    });

    it("action=unknown returns error", async () => {
      const result = await makeClient().write("nonexistent");
      expect(result).toEqual({ error: "Unknown action: nonexistent" });
    });
  });

  // =========================================================================
  // closeSession()
  // =========================================================================
  describe("closeSession()", () => {
    it("sends batch close request", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ session_id: "openclaw-123", events_processed: 5 }),
      );

      const client = makeClient();
      const result = await client.closeSession();

      expect(result.events_processed).toBe(5);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.close_session).toBe(true);
      expect(body.steps).toEqual([]);
    });

    it("falls back to sentinel event on error", async () => {
      // First call fails (batch endpoint)
      mockFetch.mockReturnValueOnce(jsonResponse({ error: "not found" }, 404));
      // Fallback call succeeds (rememberStep)
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 1, written: 1 }));

      const client = makeClient();
      const result = await client.closeSession();

      expect(result.events_processed).toBe(0);
      expect(result.session_id).toMatch(/^openclaw-/);
      // Verify fallback was called
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const fallbackBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(fallbackBody.event_type).toBe("session_end");
    });
  });

  // =========================================================================
  // supersedeCard()
  // =========================================================================
  describe("supersedeCard()", () => {
    it("PATCHes card to superseded status", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ id: "card-123", status: "superseded" }),
      );

      const result = await makeClient().supersedeCard("card-123");

      expect(result.status).toBe("superseded");
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/knowledge-cards/card-123/supersede");
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================
  describe("error handling", () => {
    it("throws descriptive error on API failure", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({ detail: "Memory not found" }, 404),
      );

      const client = makeClient();
      await expect(client.init()).rejects.toThrow(/Awareness API GET.*404/);
    });

    it("includes auth header in all requests", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({}));

      await makeClient().init();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe("Bearer test-api-key-123");
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });
});
