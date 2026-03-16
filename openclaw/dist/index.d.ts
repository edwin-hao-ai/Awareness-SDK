import type { PluginApi } from "./types";
export default function register(api: PluginApi): void;
export { AwarenessClient } from "./client";
export { registerTools } from "./tools";
export { registerHooks } from "./hooks";
export type { SearchOptions } from "./client";
export type { PluginApi, PluginConfig, PluginLogger, ToolDefinition, HookHandler, HookOptions, HookContext, HookMessage, HookResult, VectorResult, RecallResult, SessionContext, KnowledgeCard, ActionItem, Risk, IngestResponse, KnowledgeBaseResponse, ActionItemsResponse, RisksResponse, SupersedeResponse, } from "./types";
