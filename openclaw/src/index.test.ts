import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import register from "./index";
import type { PluginApi, PluginConfig, ToolDefinition, HookHandler, HookOptions, HookResult } from "./types";

// ---------------------------------------------------------------------------
// Mock fetch so client constructor doesn't fail on import
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  vi.unstubAllEnvs();
  vi.stubEnv("AWARENESS_API_KEY", "");
  vi.stubEnv("AWARENESS_MEMORY_ID", "");
  vi.stubEnv("AWARENESS_BASE_URL", "");
  vi.stubEnv("AWARENESS_AGENT_ROLE", "");
  vi.stubEnv("AWARENESS_LOCAL_URL", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

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

    const pushHook = (name: string, handler: HookHandler, options?: HookOptions) => {
      hooks.push({ name, handler, options });
    };

    const api: PluginApi = {
      registerTool: (tool) => {
        tools[tool.id] = tool;
      },
      registerHook: pushHook,
      on: (event, handler) => {
        pushHook(event, handler as HookHandler);
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

    // 6 tools: workflow, init, get_agent_prompt, recall, lookup, record
    expect(Object.keys(tools)).toHaveLength(6);
    expect(tools["__awareness_workflow__"]).toBeDefined();
    expect(tools["awareness_init"]).toBeDefined();
    expect(tools["awareness_get_agent_prompt"]).toBeDefined();
    expect(tools["awareness_recall"]).toBeDefined();
    expect(tools["awareness_lookup"]).toBeDefined();
    expect(tools["awareness_record"]).toBeDefined();

    // 3 hooks: before_prompt_build, before_agent_start (dual registration), agent_end
    expect(hooks).toHaveLength(3);
    expect(hooks[0].name).toBe("before_prompt_build");
    expect(hooks[1].name).toBe("before_agent_start");
    expect(hooks[2].name).toBe("agent_end");

    // Logs initialization
    expect(logCalls.some((l) => l.includes("initialized"))).toBe(true);
    expect(logCalls.some((l) => l.includes("mem-integration-001"))).toBe(true);
  });

  it("registers full tools in local mode when apiKey missing (no crash)", () => {
    const { api, tools, hooks, logCalls } = makeApi({ apiKey: "" });
    register(api);

    // New behavior: optimistically register full tools for local daemon mode
    expect(Object.keys(tools)).toHaveLength(6);
    expect(tools["awareness_init"]).toBeDefined();
    expect(tools["awareness_recall"]).toBeDefined();
    expect(tools["awareness_record"]).toBeDefined();

    // 3 hooks: before_prompt_build + before_agent_start (dual) + agent_end (local mode, not setup mode)
    expect(hooks).toHaveLength(3);
    expect(hooks[0].name).toBe("before_prompt_build");
    expect(hooks[1].name).toBe("before_agent_start");
    expect(hooks[2].name).toBe("agent_end");

    // Should log registration (daemon check happens in background)
    expect(logCalls.some((l) => l.includes("registered"))).toBe(true);
  });

  it("registers full tools in local mode when memoryId missing (no crash)", () => {
    const { api, tools, hooks, logCalls } = makeApi({ memoryId: "" });
    register(api);

    // Full tools registered (local mode with memoryId="local")
    expect(Object.keys(tools)).toHaveLength(6);
    expect(tools["awareness_init"]).toBeDefined();
    expect(hooks).toHaveLength(3);
    expect(logCalls.some((l) => l.includes("registered"))).toBe(true);
  });

  it("registers full tools even with no credentials at all (local-first)", () => {
    const { api, tools, hooks } = makeApi({ apiKey: "", memoryId: "" });
    register(api);

    // Even with zero config, local mode tools are registered optimistically
    expect(Object.keys(tools)).toHaveLength(6);
    expect(tools["awareness_init"]).toBeDefined();
    expect(hooks).toHaveLength(3);
  });

  it("sync register returns immediately (no async blocking)", () => {
    const { api } = makeApi({ apiKey: "" });
    // register should be sync — if it returned a Promise, this would be truthy
    const result = register(api);
    expect(result).toBeUndefined(); // void, not Promise
  });

  it("applies default config values", () => {
    const { api, tools, hooks } = makeApi({
      apiKey: "key",
      memoryId: "mem-1",
    } as Partial<PluginConfig>);

    // Should not throw — defaults are applied internally
    register(api);
    expect(Object.keys(tools)).toHaveLength(6);
    // 3 hooks registered via api.on() from registerHooks (before_prompt_build + before_agent_start + agent_end)
    expect(hooks).toHaveLength(3);
  });

  it("skips hooks when autoRecall=false and autoCapture=false", () => {
    const { api, hooks } = makeApi({
      autoRecall: false,
      autoCapture: false,
    });

    register(api);
    // No hooks registered (neither via registerHook nor on)
    expect(hooks).toHaveLength(0);
  });

  it("only registers recall hooks when autoCapture=false", () => {
    const { api, hooks } = makeApi({
      autoRecall: true,
      autoCapture: false,
    });

    register(api);
    // before_prompt_build + before_agent_start (dual registration), no agent_end
    expect(hooks).toHaveLength(2);
    expect(hooks[0].name).toBe("before_prompt_build");
    expect(hooks[1].name).toBe("before_agent_start");
  });

  // =========================================================================
  // OpenClaw Plugin Manifest Compliance
  // =========================================================================
  describe("OpenClaw manifest compliance", () => {
    it("plugin.json declares kind=memory", async () => {
      const { default: manifest } = await import("../openclaw.plugin.json");
      expect(manifest.kind).toBe("memory");
    });

    it("plugin.json configSchema has no required fields (graceful degradation)", async () => {
      const { default: manifest } = await import("../openclaw.plugin.json");
      // required removed — plugin handles missing credentials in setup mode
      expect(manifest.configSchema.required).toBeUndefined();
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
  // Config Resolution: pluginConfig vs config fallback
  // =========================================================================
  describe("config resolution (pluginConfig vs config)", () => {
    it("prefers pluginConfig over config when both are present", () => {
      const tools: Record<string, ToolDefinition> = {};
      const hooks: { name: string; handler: HookHandler; options?: HookOptions }[] = [];
      const pushHook = (name: string, handler: HookHandler, options?: HookOptions) => {
        hooks.push({ name, handler, options });
      };

      const api: PluginApi = {
        registerTool: (tool) => { tools[tool.id] = tool; },
        registerHook: pushHook,
        on: (event, handler) => { pushHook(event, handler as HookHandler); },
        // config = entire openclaw.json (no apiKey at top level)
        config: { plugins: { "memory-awareness": { config: { apiKey: "wrong" } } } },
        // pluginConfig = correct plugin-specific config
        pluginConfig: {
          apiKey: "correct-key",
          memoryId: "mem-from-pluginConfig",
          agentRole: "reviewer_agent",
        },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      };

      register(api);

      // Should use pluginConfig values — verify via log output
      const infoFn = api.logger.info as ReturnType<typeof vi.fn>;
      const logMsg = infoFn.mock.calls[0]?.[0] ?? "";
      expect(logMsg).toContain("mem-from-pluginConfig");
      expect(logMsg).toContain("reviewer_agent");
    });

    it("falls back to config when pluginConfig is undefined", () => {
      const api: PluginApi = {
        registerTool: vi.fn(),
        registerHook: vi.fn(),
        on: vi.fn(),
        config: {
          apiKey: "key-from-config",
          memoryId: "mem-from-config",
        },
        // pluginConfig intentionally omitted
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      };

      register(api);
      const infoFn = api.logger.info as ReturnType<typeof vi.fn>;
      expect(infoFn.mock.calls[0]?.[0]).toContain("mem-from-config");
    });

    it("prefers environment overrides over plugin config in cloud mode", () => {
      vi.stubEnv("AWARENESS_API_KEY", "env-key");
      vi.stubEnv("AWARENESS_MEMORY_ID", "env-mem");
      vi.stubEnv("AWARENESS_BASE_URL", "https://env.awareness.test/api/v1");
      vi.stubEnv("AWARENESS_AGENT_ROLE", "env_agent");

      const api: PluginApi = {
        registerTool: vi.fn(),
        registerHook: vi.fn(),
        on: vi.fn(),
        pluginConfig: {
          apiKey: "config-key",
          memoryId: "config-mem",
          baseUrl: "https://config.awareness.test/api/v1",
          agentRole: "builder_agent",
        },
        config: {},
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      };

      register(api);
      const infoFn = api.logger.info as ReturnType<typeof vi.fn>;
      expect(infoFn.mock.calls[0]?.[0]).toContain("env-mem");
      expect(infoFn.mock.calls[0]?.[0]).toContain("env_agent");
    });

    it("registers local mode when entire openclaw.json is passed as config (no apiKey at root)", () => {
      const hooks: { name: string; handler: HookHandler; options?: HookOptions }[] = [];
      const api: PluginApi = {
        registerTool: vi.fn(),
        registerHook: vi.fn(),
        on: (event, handler) => { hooks.push({ name: event, handler: handler as HookHandler }); },
        // Simulates the bug: config = whole openclaw.json, apiKey is nested inside plugins
        config: {
          "$schema": "https://openclaw.dev/schemas/openclaw.json",
          plugins: {
            "memory-awareness": {
              package: "@awareness-sdk/openclaw-memory",
              config: { apiKey: "nested-key", memoryId: "nested-mem" },
            },
          },
        },
        // pluginConfig not provided by old host version
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      };

      // apiKey is undefined at root level → registers local mode tools (not crash)
      register(api);
      // 6 tools registered via registerTool, 3 hooks via api.on (before_prompt_build + before_agent_start + agent_end)
      expect(api.registerTool).toHaveBeenCalledTimes(6);
      expect(hooks).toHaveLength(3);
    });

    it("handles config with string coercion for non-string values", () => {
      const api: PluginApi = {
        registerTool: vi.fn(),
        registerHook: vi.fn(),
        on: vi.fn(),
        pluginConfig: {
          apiKey: "test-key",
          memoryId: "mem-1",
          recallLimit: "12", // string instead of number
          autoRecall: 0,     // falsy number instead of boolean
        },
        config: {},
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      };

      // Should not throw — String/Boolean/Number coercion handles it
      register(api);
      expect(api.registerTool).toHaveBeenCalled();
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
