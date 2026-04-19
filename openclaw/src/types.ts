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
  localUrl: string;
  embeddingLanguage: "english" | "multilingual";
  /** Minimum message count before auto-capture fires. Default: 0 (capture all). */
  captureMinTurns?: number;
  /** Only capture conversations matching these categories. Default: [] (all). */
  captureCategories?: string[];
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

  /** Register a lifecycle event handler (real OpenClaw API). */
  on(event: string, handler: (event: unknown) => Promise<unknown> | void): void;

  /** Register a lifecycle hook with optional priority (alias for on(); priority ignored by host). */
  registerHook(name: string, handler: HookHandler, options?: HookOptions): void;

  /**
   * Raw config object provided by the host.
   * WARNING: In some OpenClaw versions this is the ENTIRE openclaw.json,
   * not the plugin-specific config. Always prefer `pluginConfig` when available.
   */
  config: Record<string, unknown>;

  /**
   * Plugin-specific configuration (the `config` block from openclaw.json
   * `plugins.<plugin-id>.config`). Prefer this over `config`.
   */
  pluginConfig?: Record<string, unknown>;

  /** Structured logger provided by the host. */
  logger: PluginLogger;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  id: string;
  /** Tool name used by the OpenClaw host for registration. Should match id. */
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (toolCallId: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
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

  /** Whether the agent run completed successfully (available in agent_end). */
  success?: boolean;
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
  id?: string;
  type?: string;
  title?: string;
  summary?: string;
  content?: string;
  score?: number;
  tags?: string[];
  source?: string;
  created_at?: string;
  tokens_est?: number;
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

export interface ActiveSkill {
  /** Short skill name */
  title?: string;
  /** Injectable skill prompt — behavioral guidance in imperative mood */
  summary?: string;
  /** Step-by-step execution instructions */
  methods?: string[];
}

// ---------------------------------------------------------------------------
// Skill — full record shape returned by /skills endpoints and the local daemon
// ---------------------------------------------------------------------------

export interface SkillMethod {
  step: number;
  description: string;
  tool_hint?: string;
}

export interface SkillTrigger {
  pattern: string;
  weight?: number;
}

export interface Skill {
  id: string;
  memory_id: string;
  user_id?: string | null;
  name: string;
  summary: string;
  methods: SkillMethod[];
  trigger_conditions: SkillTrigger[];
  tags: string[];
  source_card_ids: string[];
  /** Lifecycle stage; typed union with a `string` fallback for legacy rows. */
  growth_stage?: "seedling" | "budding" | "evergreen" | (string & {});
  /** Known failure modes + how to avoid them (F-059). */
  pitfalls?: string[];
  /** Post-run check signals that confirm successful execution (F-059). */
  verification?: string[];
  usage_count?: number;
  last_used_at?: string | null;
  decay_score?: number;
  pinned?: boolean;
  /** active | archived | merged */
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SkillListResponse {
  skills?: Skill[];
  total?: number;
}

export interface SessionContext {
  memory_id?: string;
  generated_at?: string;
  days_included?: number;
  last_sessions?: SessionSummary[];
  recent_days?: DayNarrative[];
  open_tasks?: ActionItem[];
  /** Personal preferences, identity, career — surfaced first in init */
  user_preferences?: KnowledgeCard[];
  knowledge_cards?: KnowledgeCard[];
  /** Reusable skill prompts pre-loaded at session start for token efficiency */
  active_skills?: ActiveSkill[];
  /** Attention summary for stale tasks and high risks */
  attention_summary?: Record<string, unknown>;
  /** Server-side rendered XML context — use directly when available to avoid client-side drift */
  rendered_context?: string;
  trace_id?: string;
}

export interface DayNarrative {
  date?: string;
  narrative?: string;
  count?: number;
}

export interface KnowledgeCard {
  id?: string;
  category?: string; // problem_solution | decision | workflow | key_point | pitfall | insight | skill | personal_preference | important_detail | plan_intention | activity_preference | health_info | career_info | custom_misc
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

export interface PerceptionSignal {
  type?: "contradiction" | "resonance" | "pattern" | "staleness" | "related_decision";
  title?: string;
  /** Human-readable summary (max 150 chars) */
  summary?: string;
  category?: string;
  card_id?: string;
  /** Human-readable message with emoji */
  message?: string;
  /** (resonance) Days since the original memory */
  days_ago?: number;
  /** (staleness) Days since last update */
  days_since_update?: number;
  /** (pattern) Number of occurrences */
  count?: number;
}

export interface IngestResponse {
  accepted?: number;
  written?: number;
  failed?: number;
  duplicates?: number;
  status?: string;
  trace_id?: string;
  /** Perception signals triggered by this ingest */
  perception?: PerceptionSignal[];
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
