export type JsonObject = Record<string, unknown>;

export interface MemoryCloudClientConfig {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  sessionPrefix?: string;
  defaultSource?: string;
  /** Pass an OpenAI/Anthropic client to auto-extract insights from record(). */
  extractionLlm?: any;
  /** Model for extraction (default: "gpt-4o-mini" for OpenAI, "claude-haiku-4-5-20251001" for Anthropic). */
  extractionModel?: string;
  /** Max tokens for extraction output. Env: AWARENESS_EXTRACTION_MAX_TOKENS. Default: 16384. */
  extractionMaxTokens?: number;
  /** User ID for multi-user memories. */
  userId?: string;
  /** Agent role identifier. */
  agentRole?: string;
  /** Deployment mode: "cloud" (default) | "local" | "auto". */
  mode?: "cloud" | "local" | "auto";
  /** Local server URL for "local" or "auto" mode. Default: "http://localhost:8765". */
  localUrl?: string;
}

export interface RetrieveResponse extends JsonObject {
  results?: JsonObject[];
  trace_id?: string;
}

export interface WriteResponse extends JsonObject {
  status?: string;
  message?: string;
  job_id?: string;
  trace_id?: string;
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

export interface IngestEventsResponse extends JsonObject {
  accepted?: number;
  written?: number;
  failed?: number;
  duplicates?: number;
  summaries_generated?: number;
  queued?: number;
  async_job_id?: string | null;
  status?: string;
  trace_id?: string;
  /** Perception signals triggered by this ingest */
  perception?: PerceptionSignal[];
}

export interface ExportPackageResponse {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  trace_id?: string;
}

export interface ParsedSafetensors {
  path: string;
  size: number;
  bytes?: Uint8Array;
}

export interface ParsedExportPackage {
  manifest: JsonObject;
  files: string[];
  vectorsJsonl: JsonObject[];
  vectorIndex: JsonObject[];
  chunks: JsonObject[];
  kvSummary: JsonObject | null;
  safetensors: ParsedSafetensors | null;
  binaryFiles?: Record<string, Uint8Array>;
}

export interface DayNarrative {
  date?: string;
  narrative?: string;
  count?: number;
}

export interface OpenTask {
  id?: string;
  title?: string;
  priority?: string;
  status?: string;
  detail?: string;
  context?: string;
  estimated_effort?: string;
  user_id?: string; // multi-user mode: the user this task belongs to
}

export interface UpdateTaskResult {
  id?: string;
  memory_id?: string;
  title?: string;
  priority?: string;
  status?: string;
  updated_at?: string;
}

export interface KnowledgeCard {
  category?: string; // problem_solution | decision | workflow | key_point | pitfall | insight | skill | personal_preference | important_detail | plan_intention | activity_preference | health_info | career_info | custom_misc
  title?: string;
  summary?: string;
  tags?: string[];
  confidence?: number;
  salience_score?: number; // intrinsic importance [0.5, 2.0]; higher = resists decay more
  /** Zero-LLM generated instruction: "When [scenario], [action] because [reason]" */
  actionable_rule?: string;
  /** Number of times this card influenced LLM behavior */
  influence_count?: number;
  status?: string; // open | in_progress | resolved | noted | superseded
  user_id?: string; // multi-user mode: the user this card belongs to
  /** Explainability metadata (decay_score, intent_boost, source_date, etc.) */
  _attribution?: CardAttribution;
}

export interface HandoffTask {
  title?: string;
  priority?: string;
  status?: string;
}

export interface HandoffKnowledge {
  title?: string;
  summary?: string;
}

export interface SessionSummary {
  session_id?: string;
  date?: string;
  summary?: string;
  event_count?: number;
}

/**
 * A reusable skill extracted from memory.
 * Skills are injected at session start for token-efficient reuse.
 * When a task matches a skill's domain, apply its summary as behavioral guidance.
 */
export interface ActiveSkill {
  /** Short skill name (e.g. "Deploy with Docker Compose") */
  title?: string;
  /** Injectable skill prompt — 2-5 sentences of behavioral guidance in imperative mood */
  summary?: string;
  /** Step-by-step execution instructions */
  methods?: string[];
}

/** Explainability metadata for a vector search result. */
export interface VectorAttribution {
  /** How the result was matched: "hybrid" | "vector" | "bm25" */
  matched_by?: string;
  /** Cosine similarity score (0-1) */
  vector_score?: number;
  /** Reciprocal rank fusion score */
  rrf_score?: number;
  /** Rank in vector search */
  vector_rank?: number;
  /** Rank in BM25 search (0 = not matched) */
  bm25_rank?: number;
  /** Whether BM25 also matched this result */
  bm25_matched?: boolean;
  /** Session ID of the source event */
  source_session?: string;
  /** ISO date of the source event */
  source_date?: string;
  /** Whether chunk reconstruction was applied */
  reconstructed?: boolean;
  /** Number of chunks stitched together */
  chunk_count?: number;
}

/** Explainability metadata for a knowledge card. */
export interface CardAttribution {
  /** ISO date when the card was created */
  source_date?: string;
  /** ISO date of last access */
  last_accessed?: string;
  /** Ebbinghaus decay-adjusted relevance score */
  decay_score?: number;
  /** Intent-based category boost multiplier (null if none) */
  intent_boost?: number | null;
  /** Number of times this card has been recalled */
  access_count?: number;
  /** "update" | "reversal" | null — if card replaced another */
  evolution?: string | null;
}

/** Summary of items requiring LLM-side attention at session start. */
export interface AttentionSummary {
  /** Number of tasks pending/in_progress for > 3 days */
  stale_tasks?: number;
  /** Number of active high-risk/pitfall knowledge cards */
  high_risks?: number;
  /** Total open tasks (pending + in_progress) */
  total_open_tasks?: number;
  /** Total knowledge cards returned in context */
  total_knowledge_cards?: number;
  /** True when stale_tasks > 0 or high_risks > 0 — signals the LLM should review and act */
  needs_attention?: boolean;
}

/** Actionable alert surfaced at session start. */
export interface ProactiveAlert {
  /** "stale_task" | "last_session_handoff" | "recent_contradiction" */
  type?: string;
  /** "info" | "warning" */
  severity?: string;
  /** Human-readable alert title */
  title?: string;
  /** Detailed alert message */
  message?: string;
  /** (stale_task only) The stale task's ID */
  task_id?: string;
  /** (stale_task only) Days since creation */
  days_stale?: number;
  /** (recent_contradiction only) The new card's ID */
  card_id?: string;
  /** (recent_contradiction only) The superseded card's title */
  old_title?: string;
  /** (last_session_handoff only) Recent events */
  last_events?: JsonObject[];
}

export interface SessionContextResponse extends JsonObject {
  memory_id?: string;
  generated_at?: string;
  days_included?: number;
  last_sessions?: SessionSummary[];
  recent_days?: DayNarrative[];
  open_tasks?: OpenTask[];
  /** Personal preferences, identity, career — surfaced first in init for highest visibility */
  user_preferences?: KnowledgeCard[];
  /** Technical knowledge cards (non-preference categories) */
  knowledge_cards?: KnowledgeCard[];
  active_skills?: ActiveSkill[];
  /** Actionable alerts: stale tasks, session handoff, recent contradictions */
  proactive_alerts?: ProactiveAlert[];
  /** LLM-side attention summary — when needs_attention is true, review and act on stale tasks / high risks */
  attention_summary?: AttentionSummary;
  /** Pre-assembled memory context — inject as system context verbatim if present */
  rendered_context?: string;
  trace_id?: string;
}

export interface RiskItem {
  title?: string;
  level?: string; // high | medium | low
  detail?: string;
  mitigation?: string;
  status?: string; // active | mitigated | resolved
}

/**
 * Result from structured or hybrid recall mode.
 *
 * Cards are split into verified (high evidence coverage) and unverified tiers.
 * In hybrid mode, vectorContext or rawChunks may also be present.
 */
export interface StructuredRecallResult extends JsonObject {
  recall_mode?: "structured" | "hybrid";
  memory_id?: string;
  query_intent?: string; // "debug" | "architecture" | "definition" | "planning" | "personal" | "general"
  recent_days?: DayNarrative[];
  verified_cards?: KnowledgeCard[];
  unverified_cards?: KnowledgeCard[];
  open_tasks?: OpenTask[];
  risks?: RiskItem[];
  vector_context?: JsonObject[]; // hybrid only (top-K vector results)
  raw_chunks?: JsonObject[]; // hybrid only (when include_raw_chunks=True)
  generated_at?: string;
}

export interface KnowledgeBaseResponse {
  total?: number;
  cards?: KnowledgeCard[];
}

export interface PendingTasksResponse {
  total?: number;
  in_progress?: number;
  pending?: number;
  tasks?: OpenTask[];
  trace_id?: string;
}

export interface HandoffContextResponse {
  memory_id?: string;
  briefing_for?: string;
  recent_progress?: string[];
  open_tasks?: HandoffTask[];
  key_knowledge?: HandoffKnowledge[];
  token_estimate?: number;
  trace_id?: string;
}

export interface MemoryProfileSection {
  title?: string;
  summary?: string;
  confidence?: number;
  category?: string;
  tags?: string[];
}

export interface MemoryProfile {
  user_preferences?: MemoryProfileSection[];
  key_decisions?: MemoryProfileSection[];
  core_knowledge?: MemoryProfileSection[];
  personal_context?: MemoryProfileSection[];
  active_risks?: Record<string, any>[];
  key_entities?: string[];
  card_count?: number;
  risk_count?: number;
  action_count?: number;
  generated_at?: string;
}

export interface DetectRoleResult {
  detected_role?: string;
  confidence?: number;
  available_roles?: string[];
}

export interface MemoryUsersResult {
  users?: Record<string, any>[];
  total?: number;
}

export interface ExtractionEvent {
  content?: string;
  event_type?: string;
  source?: string;
}

export interface ExistingCardRef {
  id?: string;
  title?: string;
  summary?: string;
  category?: string;
}

export interface ExistingTaskRef {
  id?: string;
  title?: string;
  detail?: string;
  status?: string;
  priority?: string;
}

export interface CompletedTask {
  task_id?: string;
  reason?: string;
}

/**
 * Returned by the server when it triggers client-side extraction.
 *
 * The SDK interceptor processes this automatically using the user's LLM.
 * MCP Agents should process _extraction_instruction in the tool response.
 */
export interface ExtractionRequest {
  memory_id?: string;
  session_id?: string;
  events?: ExtractionEvent[];
  existing_cards?: ExistingCardRef[];
  existing_tasks?: ExistingTaskRef[];
  system_prompt?: string;
}

export interface SubmitInsightsResult {
  status?: string;
  memory_id?: string;
  cards_created?: number;
  cards_skipped_dup?: number;
  cards_updated?: number;
  risks_created?: number;
  action_items_created?: number;
  tasks_auto_completed?: number;
}

export interface AgentProfile {
  key?: string;
  title?: string;
  agent_role?: string;
  kind?: string; // "agent" | "skill"
  responsibility?: string;
  when_to_use?: string;
  ingest_pattern?: string;
  recall_pattern?: string;
  identity?: string;
  critical_rules?: string[];
  workflow?: string;
  communication_style?: string;
  success_metrics?: string;
  system_prompt?: string;
  activation_prompt?: string;
}

export interface AgentListResponse {
  agents?: AgentProfile[];
  total?: number;
}

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
  /** seedling | budding | evergreen */
  growth_stage: string;
  usage_count: number;
  last_used_at?: string | null;
  decay_score: number;
  pinned: boolean;
  /** active | archived | merged */
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SkillListResponse {
  skills: Skill[];
  total: number;
}

export interface ListSkillsOptions {
  status?: string;
  sort?: string;
  limit?: number;
}

/**
 * Input for the unified `record()` write method.
 */
export interface RecordInput {
  memoryId: string;
  /** String → single event; Array → batch events; Object → single structured event. */
  content?: string | Array<Record<string, any>> | Record<string, any>;
  /** Pre-extracted insights to submit (bypasses server-side LLM). */
  insights?: {
    knowledge_cards?: Array<Record<string, any>>;
    action_items?: Array<Record<string, any>>;
    risks?: Array<Record<string, any>>;
    entities?: Array<Record<string, any>>;
    relations?: Array<Record<string, any>>;
    completed_tasks?: CompletedTask[];
    turn_brief?: string;
  };
  scope?: "timeline" | "knowledge";
  sessionId?: string;
  source?: string;
  userId?: string;
  agentRole?: string;
  generateSummary?: boolean;
  maxEvents?: number;
  traceId?: string;
}
