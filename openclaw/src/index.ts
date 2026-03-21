import type { PluginApi, PluginConfig, HookContext, HookResult } from "./types";
import { AwarenessClient } from "./client";
import { registerTools } from "./tools";
import { registerHooks } from "./hooks";

// ---------------------------------------------------------------------------
// Setup-only mode — registered when credentials are missing
// ---------------------------------------------------------------------------

function registerSetupMode(api: PluginApi): void {
  // Provide a tool that returns setup instructions
  api.registerTool({
    id: "awareness_setup",
    name: "awareness_setup",
    description:
      "Awareness Memory is not configured yet. Call this tool to get setup instructions.\n" +
      "The quickest way: run `npx @awareness-sdk/setup --ide openclaw` in a terminal.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          description: "Output format: 'text' (default) or 'json'",
          enum: ["text", "json"],
        },
      },
    },
    execute: async () => ({
      status: "not_configured",
      message: "Awareness Memory plugin needs an API key and Memory ID to work.",
      setup_options: [
        {
          method: "One-command setup (recommended)",
          command: "npx @awareness-sdk/setup --ide openclaw",
          description:
            "Opens browser for login, lets you pick a memory, and writes config automatically.",
        },
        {
          method: "Manual configuration",
          steps: [
            "1. Sign up or log in at https://awareness.market",
            "2. Copy your API key (starts with aw_) from Settings",
            "3. Copy your Memory ID from the memory detail page",
            '4. Edit ~/.openclaw/openclaw.json → plugins.entries["openclaw-memory"].config',
            "5. Set apiKey and memoryId, then restart OpenClaw",
          ],
        },
      ],
    }),
  });

  // Inject a hint into every session so the agent knows memory is unavailable
  api.registerHook(
    "before_agent_start",
    async (_context: HookContext): Promise<HookResult | void> => ({
      prependSystemContext:
        "[Awareness Memory] Not configured yet. " +
        "Run `npx @awareness-sdk/setup --ide openclaw` in a terminal to connect your memory in one step, " +
        "or call the awareness_setup tool for detailed instructions.",
    }),
    { priority: 10 },
  );

  api.logger.warn(
    "Awareness memory plugin loaded in setup mode — apiKey or memoryId not configured. " +
      "Run `npx @awareness-sdk/setup --ide openclaw` to complete setup.",
  );
}

// ---------------------------------------------------------------------------
// Plugin entry point — called by the OpenClaw host to initialize the plugin
// ---------------------------------------------------------------------------

export default function register(api: PluginApi): void {
  // OpenClaw host may expose plugin-specific config as `pluginConfig`
  // while `config` can be the entire openclaw.json. Try pluginConfig first.
  const raw: Record<string, unknown> = api.pluginConfig ?? api.config ?? {};

  // Resolve config with defaults matching openclaw.plugin.json configSchema
  const config: PluginConfig = {
    apiKey: String(raw.apiKey ?? ""),
    baseUrl: String(raw.baseUrl ?? "https://awareness.market/api/v1"),
    memoryId: String(raw.memoryId ?? ""),
    agentRole: String(raw.agentRole ?? "builder_agent"),
    autoRecall: raw.autoRecall !== undefined ? Boolean(raw.autoRecall) : true,
    autoCapture: raw.autoCapture !== undefined ? Boolean(raw.autoCapture) : true,
    recallLimit: raw.recallLimit !== undefined ? Number(raw.recallLimit) : 8,
  };

  // Graceful degradation: missing credentials → setup mode instead of crash
  if (!config.apiKey || !config.memoryId) {
    registerSetupMode(api);
    return;
  }

  // Create the HTTP client
  const client = new AwarenessClient(
    config.baseUrl,
    config.apiKey,
    config.memoryId,
    config.agentRole,
  );

  // Register tools and hooks
  registerTools(api, client);
  registerHooks(api, client, config);

  api.logger.info(
    `Awareness memory plugin initialized — ` +
      `memory=${config.memoryId}, role=${config.agentRole}, ` +
      `autoRecall=${config.autoRecall}, autoCapture=${config.autoCapture}`,
  );
}

// Re-export types and client for programmatic usage
export { AwarenessClient } from "./client";
export { registerTools } from "./tools";
export { registerHooks } from "./hooks";
export type { SearchOptions } from "./client";
export type {
  PluginApi,
  PluginConfig,
  PluginLogger,
  ToolDefinition,
  HookHandler,
  HookOptions,
  HookContext,
  HookMessage,
  HookResult,
  VectorResult,
  RecallResult,
  SessionContext,
  KnowledgeCard,
  ActionItem,
  Risk,
  IngestResponse,
  KnowledgeBaseResponse,
  ActionItemsResponse,
  RisksResponse,
  SupersedeResponse,
} from "./types";
