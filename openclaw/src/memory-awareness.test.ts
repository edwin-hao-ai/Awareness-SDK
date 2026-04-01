import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import awarenessPlugin from "./memory-awareness";

// ---------------------------------------------------------------------------
// Mock fetch
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

// ---------------------------------------------------------------------------
// Helper to create mock OpenClaw API
// ---------------------------------------------------------------------------

function makeMockApi(pluginConfig?: Record<string, unknown>, config?: Record<string, unknown>) {
  const tools: Record<string, unknown> = {};
  const hooks: Record<string, Function[]> = {};
  const logCalls: string[] = [];

  return {
    api: {
      pluginConfig,
      config,
      registerTool(tool: { name: string }) {
        tools[tool.name] = tool;
      },
      on(event: string, handler: Function) {
        if (!hooks[event]) hooks[event] = [];
        hooks[event].push(handler);
      },
      logger: {
        info: (msg: string) => logCalls.push(`info: ${msg}`),
        warn: (msg: string) => logCalls.push(`warn: ${msg}`),
        error: (msg: string) => logCalls.push(`error: ${msg}`),
      },
    },
    tools,
    hooks,
    logCalls,
  };
}

const VALID_CONFIG = {
  apiKey: "test-key-123",
  memoryId: "mem-001",
  baseUrl: "https://awareness.market/api/v1",
  agentRole: "builder_agent",
};

// ===========================================================================
// Native Adapter Tests
// ===========================================================================

describe("memory-awareness (native OpenClaw adapter)", () => {
  describe("plugin metadata", () => {
    it("has correct id and kind", () => {
      expect(awarenessPlugin.id).toBe("openclaw-memory");
      expect(awarenessPlugin.kind).toBe("memory");
    });

    it("has a configSchema with parse()", () => {
      expect(typeof awarenessPlugin.configSchema.parse).toBe("function");
    });
  });

  // =========================================================================
  // Config Resolution
  // =========================================================================
  describe("config resolution", () => {
    it("prefers pluginConfig over config", () => {
      const { api, logCalls } = makeMockApi(VALID_CONFIG, {
        "$schema": "https://openclaw.dev/schemas/openclaw.json",
        plugins: {},
      });

      awarenessPlugin.register(api);
      expect(logCalls.some((l) => l.includes("mem-001"))).toBe(true);
    });

    it("falls back to config when pluginConfig is undefined", () => {
      const { api, logCalls } = makeMockApi(undefined, VALID_CONFIG);

      awarenessPlugin.register(api);
      expect(logCalls.some((l) => l.includes("mem-001"))).toBe(true);
    });

    it("throws when apiKey is missing", () => {
      const { api } = makeMockApi({ memoryId: "mem-1" });

      expect(() => awarenessPlugin.register(api)).toThrow("apiKey is required");
    });

    it("throws when memoryId is missing", () => {
      const { api } = makeMockApi({ apiKey: "key" });

      expect(() => awarenessPlugin.register(api)).toThrow("memoryId is required");
    });

    it("throws when config is null/undefined", () => {
      const { api } = makeMockApi(undefined, undefined);

      expect(() => awarenessPlugin.register(api)).toThrow();
    });

    it("applies defaults for optional fields", () => {
      const { api, logCalls } = makeMockApi({
        apiKey: "key",
        memoryId: "mem-1",
      });

      awarenessPlugin.register(api);
      // Should use default role
      expect(logCalls.some((l) => l.includes("builder_agent"))).toBe(true);
      expect(logCalls.some((l) => l.includes("autoRecall=true"))).toBe(true);
    });
  });

  // =========================================================================
  // Tool Registration
  // =========================================================================
  describe("tool registration", () => {
    it("registers 3 tools (recall, lookup, record)", () => {
      const { api, tools } = makeMockApi(VALID_CONFIG);

      awarenessPlugin.register(api);
      expect(Object.keys(tools)).toHaveLength(3);
      expect(tools["awareness_recall"]).toBeDefined();
      expect(tools["awareness_lookup"]).toBeDefined();
      expect(tools["awareness_record"]).toBeDefined();
    });
  });

  // =========================================================================
  // Hook Registration
  // =========================================================================
  describe("hook registration", () => {
    it("registers before_prompt_build and before_agent_start when autoRecall=true", () => {
      const { api, hooks } = makeMockApi(VALID_CONFIG);

      awarenessPlugin.register(api);
      expect(hooks["before_prompt_build"]).toBeDefined();
      expect(hooks["before_prompt_build"]).toHaveLength(1);
      expect(hooks["before_agent_start"]).toBeDefined();
      expect(hooks["before_agent_start"]).toHaveLength(1);
    });

    it("registers agent_end when autoCapture=true", () => {
      const { api, hooks } = makeMockApi(VALID_CONFIG);

      awarenessPlugin.register(api);
      expect(hooks["agent_end"]).toBeDefined();
      expect(hooks["agent_end"]).toHaveLength(1);
    });

    it("skips hooks when autoRecall=false and autoCapture=false", () => {
      const { api, hooks } = makeMockApi({
        ...VALID_CONFIG,
        autoRecall: false,
        autoCapture: false,
      });

      awarenessPlugin.register(api);
      expect(hooks["before_prompt_build"]).toBeUndefined();
      expect(hooks["before_agent_start"]).toBeUndefined();
      expect(hooks["agent_end"]).toBeUndefined();
    });
  });

  // =========================================================================
  // Hook Null Guards
  // =========================================================================
  describe("hook null guards", () => {
    it("before_prompt_build handles undefined event without crashing", async () => {
      const { api, hooks } = makeMockApi(VALID_CONFIG);

      awarenessPlugin.register(api);
      const handler = hooks["before_prompt_build"][0];

      // Should not throw
      const result = await handler(undefined);
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("before_prompt_build handles null event without crashing", async () => {
      const { api, hooks } = makeMockApi(VALID_CONFIG);

      awarenessPlugin.register(api);
      const handler = hooks["before_prompt_build"][0];

      const result = await handler(null);
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("before_prompt_build skips very short prompts (< 5 chars)", async () => {
      const { api, hooks } = makeMockApi(VALID_CONFIG);

      awarenessPlugin.register(api);
      const handler = hooks["before_prompt_build"][0];

      const result = await handler({ prompt: "hi" });
      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("agent_end handles undefined event without crashing", async () => {
      const { api, hooks } = makeMockApi(VALID_CONFIG);

      awarenessPlugin.register(api);
      const handler = hooks["agent_end"][0];

      // Should not throw
      await handler(undefined);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("agent_end handles null event without crashing", async () => {
      const { api, hooks } = makeMockApi(VALID_CONFIG);

      awarenessPlugin.register(api);
      const handler = hooks["agent_end"][0];

      await handler(null);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("agent_end skips when success=false", async () => {
      const { api, hooks } = makeMockApi(VALID_CONFIG);

      awarenessPlugin.register(api);
      const handler = hooks["agent_end"][0];

      await handler({ success: false, messages: [{ role: "user", content: "a long enough message for testing" }] });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Auto-Recall Integration
  // =========================================================================
  describe("before_prompt_build auto-recall", () => {
    it("injects memory context for valid prompt", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          memory_id: "mem-001",
          recent_days: [],
          open_tasks: [],
          knowledge_cards: [{ title: "Auth", category: "decision", summary: "Use JWT" }],
          last_sessions: [],
        }),
      );
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          results: [{ content: "JWT implementation notes", score: 0.9 }],
        }),
      );

      const { api, hooks } = makeMockApi(VALID_CONFIG);
      awarenessPlugin.register(api);
      const handler = hooks["before_prompt_build"][0];

      const result = await handler({ prompt: "How does auth work in this project?" });
      expect(result).toBeDefined();
      expect(result.prependContext).toContain("<awareness-memory>");
      expect(result.prependContext).toContain("JWT");
    });

    it("continues gracefully on API error", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ error: "timeout" }, 500));

      const { api, hooks } = makeMockApi(VALID_CONFIG);
      awarenessPlugin.register(api);
      const handler = hooks["before_prompt_build"][0];

      // Should not throw
      const result = await handler({ prompt: "This should fail gracefully with a long enough prompt" });
      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // ConfigSchema.parse() validation
  // =========================================================================
  describe("configSchema.parse()", () => {
    it("parses valid config", () => {
      const cfg = awarenessPlugin.configSchema.parse(VALID_CONFIG);
      expect(cfg.apiKey).toBe("test-key-123");
      expect(cfg.memoryId).toBe("mem-001");
      expect(cfg.autoRecall).toBe(true);
      expect(cfg.recallLimit).toBe(8);
    });

    it("rejects null input", () => {
      expect(() => awarenessPlugin.configSchema.parse(null)).toThrow();
    });

    it("rejects array input", () => {
      expect(() => awarenessPlugin.configSchema.parse([1, 2, 3])).toThrow();
    });

    it("rejects missing apiKey", () => {
      expect(() =>
        awarenessPlugin.configSchema.parse({ memoryId: "m1" }),
      ).toThrow("apiKey");
    });

    it("rejects missing memoryId", () => {
      expect(() =>
        awarenessPlugin.configSchema.parse({ apiKey: "k1" }),
      ).toThrow("memoryId");
    });
  });
});
