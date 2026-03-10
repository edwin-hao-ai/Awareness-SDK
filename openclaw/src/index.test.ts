import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import register from "./index";
import type { PluginApi, PluginConfig, ToolDefinition, HookHandler, HookOptions } from "./types";

// ---------------------------------------------------------------------------
// Mock fetch so client constructor doesn't fail on import
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

// ===========================================================================
// Plugin Entry Point Tests
// ===========================================================================

describe("register (plugin entry point)", () => {
  function makeApi(configOverrides?: Partial<PluginConfig>) {
    const tools: Record<string, ToolDefinition> = {};
    const hooks: { name: string; handler: HookHandler; options?: HookOptions }[] = [];
    const logCalls: string[] = [];

    const config = {
      apiKey: "test-key-abc",
      baseUrl: "https://awareness.market/api/v1",
      memoryId: "mem-integration-001",
      agentRole: "builder_agent",
      autoRecall: true,
      autoCapture: true,
      recallLimit: 8,
      ...configOverrides,
    } as PluginConfig;

    const api: PluginApi = {
      registerTool: (tool) => {
        tools[tool.id] = tool;
      },
      registerHook: (name, handler, options) => {
        hooks.push({ name, handler, options });
      },
      config,
      logger: {
        info: (msg: string) => logCalls.push(`info: ${msg}`),
        warn: (msg: string) => logCalls.push(`warn: ${msg}`),
        error: (msg: string) => logCalls.push(`error: ${msg}`),
      },
    };

    return { api, tools, hooks, logCalls };
  }

  it("registers all tools and hooks on valid config", () => {
    const { api, tools, hooks, logCalls } = makeApi();
    register(api);

    // 5 tools: workflow, init, recall, lookup, record
    expect(Object.keys(tools)).toHaveLength(5);
    expect(tools["__awareness_workflow__"]).toBeDefined();
    expect(tools["awareness_init"]).toBeDefined();
    expect(tools["awareness_recall"]).toBeDefined();
    expect(tools["awareness_lookup"]).toBeDefined();
    expect(tools["awareness_record"]).toBeDefined();

    // 2 hooks: before_agent_start, agent_end
    expect(hooks).toHaveLength(2);
    expect(hooks[0].name).toBe("before_agent_start");
    expect(hooks[1].name).toBe("agent_end");

    // Logs initialization
    expect(logCalls.some((l) => l.includes("initialized"))).toBe(true);
    expect(logCalls.some((l) => l.includes("mem-integration-001"))).toBe(true);
  });

  it("throws on missing apiKey", () => {
    const { api } = makeApi({ apiKey: "" });
    expect(() => register(api)).toThrow("apiKey is required");
  });

  it("throws on missing memoryId", () => {
    const { api } = makeApi({ memoryId: "" });
    expect(() => register(api)).toThrow("memoryId is required");
  });

  it("applies default config values", () => {
    const config = {
      apiKey: "key",
      memoryId: "mem-1",
    } as PluginConfig;

    const api: PluginApi = {
      registerTool: vi.fn(),
      registerHook: vi.fn(),
      config,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    // Should not throw — defaults are applied internally
    register(api);
    expect(api.registerTool).toHaveBeenCalledTimes(5);
    expect(api.registerHook).toHaveBeenCalledTimes(2);
  });

  it("skips hooks when autoRecall=false and autoCapture=false", () => {
    const { api, hooks } = makeApi({
      autoRecall: false,
      autoCapture: false,
    });

    register(api);
    expect(hooks).toHaveLength(0);
  });

  it("only registers recall hook when autoCapture=false", () => {
    const { api, hooks } = makeApi({
      autoRecall: true,
      autoCapture: false,
    });

    register(api);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].name).toBe("before_agent_start");
  });

  // =========================================================================
  // OpenClaw Plugin Manifest Compliance
  // =========================================================================
  describe("OpenClaw manifest compliance", () => {
    it("plugin.json declares kind=memory", async () => {
      const { default: manifest } = await import("../openclaw.plugin.json");
      expect(manifest.kind).toBe("memory");
    });

    it("plugin.json has required configSchema fields", async () => {
      const { default: manifest } = await import("../openclaw.plugin.json");
      const required = manifest.configSchema.required;
      expect(required).toContain("apiKey");
      expect(required).toContain("memoryId");
    });

    it("plugin.json marks apiKey as sensitive", async () => {
      const { default: manifest } = await import("../openclaw.plugin.json");
      expect(manifest.uiHints.apiKey.sensitive).toBe(true);
    });

    it("plugin.json configSchema has all expected properties", async () => {
      const { default: manifest } = await import("../openclaw.plugin.json");
      const props = manifest.configSchema.properties;
      expect(props.apiKey).toBeDefined();
      expect(props.baseUrl).toBeDefined();
      expect(props.memoryId).toBeDefined();
      expect(props.agentRole).toBeDefined();
      expect(props.autoRecall).toBeDefined();
      expect(props.autoCapture).toBeDefined();
      expect(props.recallLimit).toBeDefined();
    });
  });

  // =========================================================================
  // Re-exports
  // =========================================================================
  describe("module exports", () => {
    it("exports AwarenessClient class", async () => {
      const mod = await import("./index");
      expect(mod.AwarenessClient).toBeDefined();
      expect(typeof mod.AwarenessClient).toBe("function");
    });

    it("exports registerTools and registerHooks", async () => {
      const mod = await import("./index");
      expect(mod.registerTools).toBeDefined();
      expect(mod.registerHooks).toBeDefined();
    });
  });
});
