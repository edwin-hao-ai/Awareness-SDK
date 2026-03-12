import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerTools } from "./tools";
import type { PluginApi, ToolDefinition } from "./types";
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

function setupTools(): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {};
  const api: PluginApi = {
    registerTool: (tool) => {
      tools[tool.id] = tool;
    },
    registerHook: vi.fn(),
    config: {
      apiKey: "test-key",
      baseUrl: "https://awareness.market/api/v1",
      memoryId: "mem-001",
      agentRole: "builder_agent",
      autoRecall: true,
      autoCapture: true,
      recallLimit: 8,
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  const client = new AwarenessClient(
    "https://awareness.market/api/v1",
    "test-key",
    "mem-001",
    "builder_agent",
  );

  registerTools(api, client);
  return tools;
}

// ===========================================================================
// Tool Registration Tests
// ===========================================================================

describe("registerTools", () => {
  it("registers exactly 5 tools", () => {
    const tools = setupTools();
    const ids = Object.keys(tools);
    expect(ids).toHaveLength(5);
    expect(ids).toContain("__awareness_workflow__");
    expect(ids).toContain("awareness_init");
    expect(ids).toContain("awareness_recall");
    expect(ids).toContain("awareness_lookup");
    expect(ids).toContain("awareness_record");
  });

  // =========================================================================
  // __awareness_workflow__ — meta tool
  // =========================================================================
  describe("__awareness_workflow__", () => {
    it("is a reference-only tool that does not make API calls", async () => {
      const tools = setupTools();
      const result = await tools["__awareness_workflow__"].execute({});
      expect(result).toEqual({ message: "Reference-only tool. See the description for workflow." });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("description contains the 5-step workflow", () => {
      const tools = setupTools();
      const desc = tools["__awareness_workflow__"].description;
      expect(desc).toContain("SESSION START");
      expect(desc).toContain("BEFORE WORK");
      expect(desc).toContain("AFTER EVERY CHANGE");
      expect(desc).toContain("_extraction_instruction");
      expect(desc).toContain("SESSION END");
    });
  });

  // =========================================================================
  // awareness_init
  // =========================================================================
  describe("awareness_init", () => {
    it("calls client.init and returns session_id + context", async () => {
      mockFetch.mockReturnValueOnce(
        jsonResponse({
          memory_id: "mem-001",
          recent_days: [],
          open_tasks: [],
          knowledge_cards: [],
        }),
      );

      const tools = setupTools();
      const result = (await tools["awareness_init"].execute({
        days: 14,
        max_cards: 10,
        max_tasks: 5,
      })) as Record<string, unknown>;

      expect(result.session_id).toBeTruthy();
      expect(result.context).toBeDefined();
    });

    it("has user_id in inputSchema", () => {
      const tools = setupTools();
      const schema = tools["awareness_init"].inputSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      expect(props.user_id).toBeDefined();
    });
  });

  // =========================================================================
  // awareness_recall
  // =========================================================================
  describe("awareness_recall", () => {
    it("requires semantic_query", () => {
      const tools = setupTools();
      const schema = tools["awareness_recall"].inputSchema as Record<string, unknown>;
      expect(schema.required).toEqual(["semantic_query"]);
    });

    it("supports all 5 recall modes", () => {
      const tools = setupTools();
      const schema = tools["awareness_recall"].inputSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.recall_mode.enum).toEqual([
        "precise",
        "session",
        "structured",
        "hybrid",
        "auto",
      ]);
    });

    it("exposes multi_level, cluster_expand, confidence_threshold, include_installed, user_id", () => {
      const tools = setupTools();
      const schema = tools["awareness_recall"].inputSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      expect(props.full_text_weight).toBeDefined();
      expect(props.multi_level).toBeDefined();
      expect(props.cluster_expand).toBeDefined();
      expect(props.confidence_threshold).toBeDefined();
      expect(props.include_installed).toBeDefined();
      expect(props.user_id).toBeDefined();
    });

    it("passes all params to client.search", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ results: [] }));

      const tools = setupTools();
      await tools["awareness_recall"].execute({
        semantic_query: "auth decisions",
        keyword_query: "JWT token",
        scope: "knowledge",
        limit: 10,
        vector_weight: 0.8,
        full_text_weight: 0.2,
        recall_mode: "hybrid",
        multi_level: true,
        cluster_expand: false,
        confidence_threshold: 0.6,
        include_installed: true,
        user_id: "alice",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.custom_kwargs.recall_mode).toBe("hybrid");
      expect(body.custom_kwargs.multi_level).toBe(true);
      expect(body.custom_kwargs.cluster_expand).toBe(false);
      expect(body.custom_kwargs.full_text_weight).toBe(0.2);
      expect(body.confidence_threshold).toBe(0.6);
      expect(body.include_installed).toBe(true);
      expect(body.user_id).toBe("alice");
      expect(body.keyword_query).toBe("JWT token");
    });
  });

  // =========================================================================
  // awareness_lookup
  // =========================================================================
  describe("awareness_lookup", () => {
    it("requires type parameter", () => {
      const tools = setupTools();
      const schema = tools["awareness_lookup"].inputSchema as Record<string, unknown>;
      expect(schema.required).toEqual(["type"]);
    });

    it("supports all 10 lookup types", () => {
      const tools = setupTools();
      const schema = tools["awareness_lookup"].inputSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.type.enum).toEqual([
        "context",
        "tasks",
        "knowledge",
        "risks",
        "session_history",
        "timeline",
        "handoff",
        "rules",
        "graph",
        "agents",
      ]);
    });

    it("has graph/rules-specific params in schema", () => {
      const tools = setupTools();
      const schema = tools["awareness_lookup"].inputSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      expect(props.format).toBeDefined();
      expect(props.entity_id).toBeDefined();
      expect(props.entity_type).toBeDefined();
      expect(props.search).toBeDefined();
      expect(props.max_hops).toBeDefined();
    });

    it("has user_id in schema", () => {
      const tools = setupTools();
      const schema = tools["awareness_lookup"].inputSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      expect(props.user_id).toBeDefined();
    });
  });

  // =========================================================================
  // awareness_record
  // =========================================================================
  describe("awareness_record", () => {
    it("requires action parameter", () => {
      const tools = setupTools();
      const schema = tools["awareness_record"].inputSchema as Record<string, unknown>;
      expect(schema.required).toEqual(["action"]);
    });

    it("supports all 6 actions", () => {
      const tools = setupTools();
      const schema = tools["awareness_record"].inputSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.action.enum).toEqual([
        "remember",
        "remember_batch",
        "backfill",
        "ingest",
        "update_task",
        "submit_insights",
      ]);
    });

    it("has user_id and history in schema", () => {
      const tools = setupTools();
      const schema = tools["awareness_record"].inputSchema as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;
      expect(props.user_id).toBeDefined();
      expect(props.history).toBeDefined();
    });

    it("action=remember records text", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ accepted: 1 }));
      const tools = setupTools();
      await tools["awareness_record"].execute({
        action: "remember",
        text: "Important decision",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toBe("Important decision");
    });

    it("action=submit_insights sends insights data", async () => {
      mockFetch.mockReturnValueOnce(jsonResponse({ status: "ok" }));
      const tools = setupTools();
      const insights = [{ type: "knowledge_card", title: "Test" }];
      await tools["awareness_record"].execute({
        action: "submit_insights",
        content: insights,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("/insights/submit");
    });
  });
});
