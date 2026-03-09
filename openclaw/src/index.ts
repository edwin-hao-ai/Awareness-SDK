import type { PluginApi, PluginConfig } from "./types";
import { AwarenessClient } from "./client";
import { registerTools } from "./tools";
import { registerHooks } from "./hooks";

// ---------------------------------------------------------------------------
// Plugin entry point — called by the OpenClaw host to initialize the plugin
// ---------------------------------------------------------------------------

export default function register(api: PluginApi): void {
  const raw = api.config;

  // Resolve config with defaults matching openclaw.plugin.json configSchema
  const config: PluginConfig = {
    apiKey: raw.apiKey,
    baseUrl: raw.baseUrl ?? "https://awareness.market/api/v1",
    memoryId: raw.memoryId,
    agentRole: raw.agentRole ?? "builder_agent",
    autoRecall: raw.autoRecall !== undefined ? raw.autoRecall : true,
    autoCapture: raw.autoCapture !== undefined ? raw.autoCapture : true,
    recallLimit: raw.recallLimit !== undefined ? raw.recallLimit : 8,
  };

  // Validate required fields
  if (!config.apiKey) {
    throw new Error(
      "Awareness plugin: apiKey is required. " +
        "Set it in your openclaw.json plugins config.",
    );
  }
  if (!config.memoryId) {
    throw new Error(
      "Awareness plugin: memoryId is required. " +
        "Set it in your openclaw.json plugins config.",
    );
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
