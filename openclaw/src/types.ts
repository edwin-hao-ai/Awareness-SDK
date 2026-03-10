// ---------------------------------------------------------------------------
// Plugin configuration — mirrors openclaw.plugin.json configSchema
// ---------------------------------------------------------------------------

export interface PluginConfig {
  apiKey: string;
  baseUrl: string;
  memoryId: string;
  agentRole: string;
  autoRecall: boolean;
  autoCapture: boolean;
  recallLimit: number;
}

// ---------------------------------------------------------------------------
// OpenClaw Plugin API contract
// ---------------------------------------------------------------------------

export interface PluginLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface PluginApi {
  /** Register a tool that the agent can invoke explicitly. */
  registerTool(tool: ToolDefinition): void;

  /** Register a lifecycle hook. */
  registerHook(name: string, handler: HookHandler, options?: HookOptions): void;

  /** Resolved plugin configuration. */
  config: PluginConfig;

  /** Structured logger provided by the host. */
  logger: PluginLogger;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  id: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Hook definitions
// ---------------------------------------------------------------------------

export type HookHandler = (context: HookContext) => Promise<HookResult | void>;

export interface HookOptions {
  /** Execution priority — lower runs first. */
  priority?: number;
}

export interface HookContext {
  /** The user / system prompt that triggered the agent run. */
  prompt?: string;

  /** Messages exchanged during the agent run (available in agent_end). */
  messages?: HookMessage[];

  /** Mutable system prompt that hooks can prepend / append to. */
  systemPrompt?: string;
}

export interface HookMessage {
  role: string;
  content: string;
}

export interface HookResult {
  /** Optional replacement / augmented system prompt. */
  systemPrompt?: string;
  /** Prepend context to the user prompt (OpenClaw before_prompt_build). */
  prependContext?: string;
  /** Prepend to system prompt without replacing it. */
  prependSystemContext?: string;
  /** Append to system prompt without replacing it. */
  appendSystemContext?: string;
}

// ---------------------------------------------------------------------------
// Awareness API response types
// ---------------------------------------------------------------------------

export interface VectorResult {
  content?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface RecallResult {
  memory_id?: string;
  results?: VectorResult[];
  trace_id?: string;
}

export interface SessionSummary {
  session_id?: string;
  date?: string;
  summary?: string;
  event_count?: number;
}

export interface SessionContext {
  memory_id?: string;
  generated_at?: string;
  days_included?: number;
  last_sessions?: SessionSummary[];
  recent_days?: DayNarrative[];
  open_tasks?: ActionItem[];
  knowledge_cards?: KnowledgeCard[];
  trace_id?: string;
}

export interface DayNarrative {
  date?: string;
  narrative?: string;
  count?: number;
}

export interface KnowledgeCard {
  id?: string;
  category?: string;
  title?: string;
  summary?: string;
  tags?: string[];
  confidence?: number;
  status?: string;
  user_id?: string;
  agent_role?: string;
}

export interface ActionItem {
  id?: string;
  title?: string;
  priority?: string;
  status?: string;
  detail?: string;
  context?: string;
  estimated_effort?: string;
  user_id?: string;
  agent_role?: string;
}

export interface Risk {
  id?: string;
  title?: string;
  level?: string;
  status?: string;
  detail?: string;
  mitigation?: string;
  user_id?: string;
  agent_role?: string;
}

export interface IngestResponse {
  accepted?: number;
  written?: number;
  failed?: number;
  duplicates?: number;
  status?: string;
  trace_id?: string;
}

export interface KnowledgeBaseResponse {
  total?: number;
  cards?: KnowledgeCard[];
}

export interface ActionItemsResponse {
  action_items?: ActionItem[];
  total?: number;
}

export interface RisksResponse {
  risks?: Risk[];
  total?: number;
}

export interface SupersedeResponse {
  id?: string;
  status?: string;
  updated_at?: string;
}

export interface SessionEvent {
  content?: string;
  event_type?: string;
  actor?: string;
  session_id?: string;
  created_at?: string;
}

export interface SessionHistoryResult {
  memory_id?: string;
  session_id?: string;
  event_count?: number;
  events?: SessionEvent[];
}
