import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerHooks } from "./hooks";
import type { PluginApi, PluginConfig, HookResult } from "./types";
import { AwarenessClient } from "./client";

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

interface RegisteredHook {
  name: string;
  handler: (context: unknown) => Promise<unknown> | void;
}

function setupHooks(configOverrides?: Partial<PluginConfig>): RegisteredHook[] {
  const hooks: RegisteredHook[] = [];

  const config: PluginConfig = {
    apiKey: "test-key",
    baseUrl: "https://awareness.market/api/v1",
    memoryId: "mem-001",
    agentRole: "builder_agent",
    autoRecall: true,
    autoCapture: true,
    recallLimit: 8,
    ...configOverrides,
  };

  const api: PluginApi = {
    registerTool: vi.fn(),
    registerHook: vi.fn(),
    on: (event, handler) => {
      hooks.push({ name: event, handler });
    },
    config,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  const client = new AwarenessClient(
    config.baseUrl,
    config.apiKey,
    config.memoryId,
    config.agentRole,
  );

  registerHooks(api, client, config);
  return hooks;
}

// ===========================================================================
// Hook Registration Tests
// ===========================================================================

describe("registerHooks", () => {
  describe("hook registration", () => {
    it("registers before_agent_start when autoRecall=true", () => {
      const hooks = setupHooks({ autoRecall: true });
      expect(hooks.some((h) => h.name === "before_agent_start")).toBe(true);
    });

    it("registers agent_end when autoCapture=true", () => {
      const hooks = setupHooks({ autoCapture: true });
      expect(hooks.some((h) => h.name === "agent_end")).toBe(true);
    });

    it("does NOT register before_agent_start when autoRecall=false", () => {
      const hooks = setupHooks({ autoRecall: false });
      expect(hooks.some((h) => h.name === "before_agent_start")).toBe(false);
    });

    it("does NOT register agent_end when autoCapture=false", () => {
      const hooks = setupHooks({ autoCapture: false });
      expect(hooks.some((h) => h.name === "agent_end")).toBe(false);
    });

    it("before_agent_start is registered via api.on()", () => {
      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start");
      expect(hook).toBeDefined();
      expect(typeof hook!.handler).toBe("function");
    });

    it("agent_end is registered via api.on()", () => {
      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "agent_end");
      expect(hook).toBeDefined();
      expect(typeof hook!.handler).toBe("function");
    });
  });

  // =========================================================================
  // Auto-Recall Hook (before_agent_start)
  // =========================================================================
  describe("before_agent_start (auto-recall)", () => {
    it("returns void when context is undefined (e.g. plugins list)", async () => {
      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;

      // OpenClaw may call hooks with undefined context during non-agent calls
      const result = await hook.handler(undefined as unknown);
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns void when context is null", async () => {
      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;

      const result = await hook.handler(null as unknown);
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns void for empty prompt", async () => {
      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;

      const result = await hook.handler({ prompt: "" });
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("injects memory context into systemPrompt for non-empty prompt", async () => {
      // Mock init (getSessionContext)
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          memory_id: "mem-001",
          recent_days: [{ date: "2026-03-10", narrative: "Built auth module" }],
          open_tasks: [{ title: "Add tests", priority: "high", status: "pending" }],
          knowledge_cards: [
            { title: "JWT Auth", category: "decision", summary: "Using JWT for authentication" },
          ],
          last_sessions: [
            { date: "2026-03-09", event_count: 12, summary: "Worked on user module" },
          ],
        }),
      );

      // Mock search (recall)
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          results: [
            { content: "Decided JWT over session cookies", score: 0.95 },
            { content: "Added refresh token flow", score: 0.88 },
          ],
        }),
      );

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;

      const result = (await hook.handler({
        prompt: "What auth method are we using?",
        systemPrompt: "You are a helpful assistant.",
      })) as HookResult;

      // Should contain awareness-memory XML block
      expect(result.prependSystemContext).toContain("<awareness-memory>");
      expect(result.prependSystemContext).toContain("</awareness-memory>");

      // Should contain session data
      expect(result.prependSystemContext).toContain("<last-sessions>");
      expect(result.prependSystemContext).toContain("Worked on user module");

      // Should contain recent progress
      expect(result.prependSystemContext).toContain("<recent-progress>");
      expect(result.prependSystemContext).toContain("Built auth module");

      // Should contain open tasks
      expect(result.prependSystemContext).toContain("<open-tasks>");
      expect(result.prependSystemContext).toContain("Add tests");

      // Should contain knowledge cards
      expect(result.prependSystemContext).toContain("<knowledge>");
      expect(result.prependSystemContext).toContain("JWT Auth");

      // Should contain recall results
      expect(result.prependSystemContext).toContain("<recall>");
      expect(result.prependSystemContext).toContain("Decided JWT over session cookies");
      expect(result.prependSystemContext).toContain("score=\"0.950\"");

      // prependSystemContext is the primary output
      expect(result.prependSystemContext).toBeTruthy();
    });

    it("filters recall results below score 0.5", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          memory_id: "mem-001",
          recent_days: [],
          open_tasks: [],
          knowledge_cards: [],
        }),
      );
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          results: [
            { content: "Relevant", score: 0.8 },
            { content: "Low score noise", score: 0.3 },
            { content: "No score keeps", score: undefined },
          ],
        }),
      );

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;
      const result = (await hook.handler({
        prompt: "test query",
      })) as HookResult;

      expect(result.prependSystemContext).toContain("Relevant");
      expect(result.prependSystemContext).not.toContain("Low score noise");
      expect(result.prependSystemContext).toContain("No score keeps");
    });

    it("extracts keywords from prompt for full-text search", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ memory_id: "mem-001" }));
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;
      await hook.handler({
        prompt: 'Fix the bug in auth_service.py related to JWT "token expiry"',
      });

      // The search call should have keyword_query extracted
      const searchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(searchBody.keyword_query).toBeTruthy();
      // Should extract file name and quoted content
      expect(searchBody.keyword_query).toContain("auth_service.py");
      expect(searchBody.keyword_query).toContain("token expiry");
    });

    it("continues gracefully on API error", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ error: "timeout" }, 500));

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;

      // Should not throw, just return undefined
      const result = await hook.handler({ prompt: "test" });
      expect(result).toBeUndefined();
    });

    it("handles empty memory state (no sessions, no tasks, no cards)", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          memory_id: "mem-001",
          recent_days: [],
          open_tasks: [],
          knowledge_cards: [],
          last_sessions: [],
        }),
      );
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;

      const result = (await hook.handler({
        prompt: "First time setup",
      })) as HookResult;

      // Should still return valid XML even with empty state
      expect(result.prependSystemContext).toContain("<awareness-memory>");
      expect(result.prependSystemContext).toContain("</awareness-memory>");
      // Should NOT contain empty sections
      expect(result.prependSystemContext).not.toContain("<last-sessions>");
      expect(result.prependSystemContext).not.toContain("<recall>");
    });
  });

  // =========================================================================
  // Auto-Capture Hook (agent_end)
  // =========================================================================
  describe("agent_end (auto-capture)", () => {
    it("returns void when context is undefined (e.g. plugins list)", async () => {
      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "agent_end")!;

      // Should not throw on undefined context
      await hook.handler(undefined as unknown);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns void when context is null", async () => {
      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "agent_end")!;

      await hook.handler(null as unknown);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns void for empty messages", async () => {
      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "agent_end")!;

      await hook.handler({ messages: [] });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("ignores short messages (< 30 chars)", async () => {
      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "agent_end")!;

      await hook.handler({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello!" },
        ],
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("captures turn brief with first user + last assistant content", async () => {
      // record() call
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 1, written: 1 }));
      // closeSession call
      mockFetch.mockReturnValueOnce(
        jsonResponse({ session_id: "s1", events_processed: 5 }),
      );

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "agent_end")!;

      await hook.handler({
        success: true,
        messages: [
          {
            role: "user",
            content: "Please implement JWT authentication for the API using python-jose library",
          },
          {
            role: "assistant",
            content:
              "I've created the auth module in auth_service.py with JWT token generation, validation, and refresh token flow. Tests added in test_auth.py.",
          },
        ],
      });

      // Should have called record()
      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toContain("Request:");
      expect(body.content).toContain("JWT authentication");
      expect(body.content).toContain("Result:");
      expect(body.content).toContain("auth_service.py");
      expect(body.content).toContain("Turns:");
      expect(body.event_type).toBe("turn_brief");
      expect(body.source).toBe("openclaw-plugin");
    });

    it("strips awareness-memory XML from captured content", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 1 }));
      mockFetch.mockReturnValueOnce(
        jsonResponse({ session_id: "s1", events_processed: 3 }),
      );

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "agent_end")!;

      await hook.handler({
        success: true,
        messages: [
          {
            role: "user",
            content:
              "<awareness-memory><recall>old stuff</recall></awareness-memory> Build the auth module please, I need JWT authentication",
          },
          {
            role: "assistant",
            content: "Done! Created auth_service.py with JWT middleware and tests.",
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Should NOT contain the XML memory block
      expect(body.content).not.toContain("<awareness-memory>");
      expect(body.content).not.toContain("old stuff");
      // Should contain the actual user request
      expect(body.content).toContain("Build the auth module");
    });

    it("calls closeSession after record()", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 1 }));
      mockFetch.mockReturnValueOnce(
        jsonResponse({ session_id: "s1", events_processed: 5 }),
      );

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "agent_end")!;

      await hook.handler({
        success: true,
        messages: [
          { role: "user", content: "Build a complete authentication module with JWT support" },
          { role: "assistant", content: "Created auth_service.py with full JWT implementation and tests" },
        ],
      });

      // Two calls: record() + closeSession
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("continues if closeSession fails", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 1 }));
      // closeSession fails
      mockFetch.mockReturnValueOnce(jsonResponse({ error: "timeout" }, 500));
      // fallback sentinel event
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 1 }));

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "agent_end")!;

      // Should not throw
      await hook.handler({
        success: true,
        messages: [
          { role: "user", content: "Build a complete authentication module with JWT support" },
          { role: "assistant", content: "Created auth_service.py with full JWT implementation and tests" },
        ],
      });
    });
  });

  // =========================================================================
  // Keyword Extraction
  // =========================================================================
  describe("keyword extraction", () => {
    it("extracts file names from prompt", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ memory_id: "m1" }));
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;
      await hook.handler({
        prompt: "Check the bugs in main.py and config.yml and package.json",
      });

      const searchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(searchBody.keyword_query).toContain("main.py");
      expect(searchBody.keyword_query).toContain("config.yml");
      expect(searchBody.keyword_query).toContain("package.json");
    });

    it("extracts quoted content", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ memory_id: "m1" }));
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;
      await hook.handler({
        prompt: 'Fix the "connection timeout" error in the "auth service"',
      });

      const searchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(searchBody.keyword_query).toContain("connection timeout");
      expect(searchBody.keyword_query).toContain("auth service");
    });

    it("extracts UPPER_CASE identifiers", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ memory_id: "m1" }));
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;
      await hook.handler({
        prompt: "Check the JWT_SECRET and API_KEY environment variables",
      });

      const searchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(searchBody.keyword_query).toContain("JWT_SECRET");
      expect(searchBody.keyword_query).toContain("API_KEY");
    });

    it("extracts camelCase and snake_case identifiers", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ memory_id: "m1" }));
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;
      await hook.handler({
        prompt: "The getUserProfile function and user_preferences table need fixing",
      });

      const searchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(searchBody.keyword_query).toContain("getUserProfile");
      expect(searchBody.keyword_query).toContain("user_preferences");
    });

    it("limits to max 8 keywords", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ memory_id: "m1" }));
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      const hooks = setupHooks();
      const hook = hooks.find((h) => h.name === "before_agent_start")!;
      await hook.handler({
        prompt:
          'Check "bug1" "bug2" "bug3" "bug4" "bug5" "bug6" "bug7" "bug8" "bug9" "bug10" extra',
      });

      const searchBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      const keywords = searchBody.keyword_query.split(" ");
      expect(keywords.length).toBeLessThanOrEqual(8);
    });
  });
});
