from typing import Any, Dict, List, Optional, TypedDict


class RetrieveResult(TypedDict, total=False):
    results: List[Dict[str, Any]]
    trace_id: str


class WriteResult(TypedDict, total=False):
    status: str
    message: str
    mode: str
    job_id: str
    trace_id: str


class PerceptionSignal(TypedDict, total=False):
    type: str           # "contradiction" | "resonance" | "pattern" | "staleness" | "related_decision"
    title: str
    summary: str        # human-readable summary (max 150 chars)
    category: str
    card_id: str
    message: str        # human-readable message with emoji
    days_ago: int       # (resonance) days since the original memory
    days_since_update: int  # (staleness) days since last update
    count: int          # (pattern) number of occurrences


class IngestResult(TypedDict, total=False):
    accepted: int
    written: int
    failed: int
    duplicates: int
    summaries_generated: int
    queued: int
    async_job_id: str
    status: str
    trace_id: str
    perception: List[PerceptionSignal]  # perception signals triggered by this ingest


class RecordResult(TypedDict, total=False):
    """Result from the unified record() write interface."""
    memory_id: str
    session_id: str
    source: str
    events_sent: int
    ingest: IngestResult
    insights: Dict[str, Any]
    trace_id: str


class ExportPackageResult(TypedDict, total=False):
    filename: str
    content_type: str
    bytes: bytes
    trace_id: str


class ParsedSafetensors(TypedDict, total=False):
    path: str
    size: int
    bytes: bytes


class ParsedExportPackage(TypedDict, total=False):
    manifest: Dict[str, Any]
    files: List[str]
    vectors_jsonl: List[Dict[str, Any]]
    vector_index: List[Dict[str, Any]]
    chunks: List[Dict[str, Any]]
    kv_summary: Optional[Dict[str, Any]]
    safetensors: Optional[ParsedSafetensors]
    binary_files: Dict[str, bytes]


class DayNarrative(TypedDict, total=False):
    date: str
    narrative: str
    count: int


class OpenTask(TypedDict, total=False):
    id: str
    title: str
    priority: str   # high | medium | low
    status: str     # in_progress | pending
    detail: str
    context: str
    estimated_effort: str  # small | medium | large
    user_id: str    # multi-user mode: the user this task belongs to


class KnowledgeCard(TypedDict, total=False):
    category: str   # problem_solution | decision | workflow | key_point | pitfall | insight | skill | personal_preference | important_detail | plan_intention | activity_preference | health_info | career_info | custom_misc
    title: str
    summary: str
    tags: List[str]
    confidence: float
    salience_score: float  # intrinsic importance [0.5, 2.0]; higher = resists decay more
    status: str     # open | in_progress | resolved | noted | superseded
    user_id: str    # multi-user mode: the user this card belongs to
    _attribution: Optional[Dict[str, Any]]  # explainability metadata (decay_score, intent_boost, etc.)


class SessionSummary(TypedDict, total=False):
    session_id: str
    date: str
    summary: str
    event_count: int


class ActiveSkill(TypedDict, total=False):
    title: str
    summary: str    # injectable skill prompt (2-5 sentences, imperative mood)
    methods: List[str]  # numbered execution steps


class VectorAttribution(TypedDict, total=False):
    """Explainability metadata for a vector search result."""
    matched_by: str         # "hybrid" | "vector" | "bm25"
    vector_score: float     # cosine similarity (0-1)
    rrf_score: float        # reciprocal rank fusion score
    vector_rank: int        # rank in vector search
    bm25_rank: int          # rank in BM25 search (0 = not matched)
    bm25_matched: bool      # whether BM25 also matched this result
    source_session: str     # session_id of the source event
    source_date: str        # ISO date of the source event
    reconstructed: bool     # whether chunk reconstruction was applied
    chunk_count: int        # number of chunks stitched together


class CardAttribution(TypedDict, total=False):
    """Explainability metadata for a knowledge card."""
    source_date: str        # ISO date when the card was created
    last_accessed: str      # ISO date of last access
    decay_score: float      # Ebbinghaus decay-adjusted relevance score
    intent_boost: float     # intent-based category boost multiplier (null if none)
    access_count: int       # number of times this card has been recalled
    evolution: str          # "update" | "reversal" | null — if card replaced another


class AttentionSummary(TypedDict, total=False):
    """Summary of items requiring LLM-side attention at session start."""
    stale_tasks: int        # tasks pending/in_progress for > 3 days
    high_risks: int         # active high-risk/pitfall knowledge cards
    total_open_tasks: int   # total open tasks (pending + in_progress)
    total_knowledge_cards: int  # total knowledge cards returned in context
    needs_attention: bool   # True when stale_tasks > 0 or high_risks > 0


class ProactiveAlert(TypedDict, total=False):
    """Actionable alert surfaced at session start."""
    type: str               # "stale_task" | "last_session_handoff" | "recent_contradiction"
    severity: str           # "info" | "warning"
    title: str              # human-readable alert title
    message: str            # detailed alert message
    task_id: str            # (stale_task only) the stale task's ID
    days_stale: int         # (stale_task only) days since creation
    card_id: str            # (recent_contradiction only) the new card's ID
    old_title: str          # (recent_contradiction only) the superseded card's title
    last_events: List[Dict[str, Any]]  # (last_session_handoff only) recent events


class SessionContextResult(TypedDict, total=False):
    memory_id: str
    generated_at: str
    days_included: int
    last_sessions: List[SessionSummary]
    recent_days: List[DayNarrative]
    open_tasks: List[OpenTask]
    user_preferences: List[KnowledgeCard]  # personal preferences, identity, career — surfaced first in init
    knowledge_cards: List[KnowledgeCard]   # technical knowledge cards (non-preference)
    active_skills: List[ActiveSkill]  # reusable skill prompts, pre-loaded at session start
    proactive_alerts: List[ProactiveAlert]  # actionable alerts (stale tasks, handoff, contradictions)
    attention_summary: AttentionSummary  # LLM-side attention summary
    trace_id: str


class RiskItem(TypedDict, total=False):
    title: str
    level: str      # high | medium | low
    detail: str
    mitigation: str
    status: str     # active | mitigated | resolved


class StructuredRecallResult(TypedDict, total=False):
    """Result from structured or hybrid recall mode.

    Cards are split into verified (high evidence coverage) and unverified tiers.
    In hybrid mode, vector_context or raw_chunks may also be present.
    """
    recall_mode: str           # "structured" | "hybrid"
    memory_id: str
    query_intent: str          # "debug" | "architecture" | "definition" | "planning" | "personal" | "general"
    recent_days: List[DayNarrative]
    verified_cards: List[KnowledgeCard]
    unverified_cards: List[KnowledgeCard]
    open_tasks: List[OpenTask]
    risks: List[RiskItem]
    vector_context: List[Dict[str, Any]]   # hybrid only (top-K vector results)
    raw_chunks: List[Dict[str, Any]]       # hybrid only (when include_raw_chunks=True)
    generated_at: str


class KnowledgeBaseResult(TypedDict, total=False):
    total: int
    cards: List[KnowledgeCard]


class HandoffTask(TypedDict, total=False):
    title: str
    priority: str
    status: str


class HandoffKnowledge(TypedDict, total=False):
    title: str
    summary: str


class PendingTasksResult(TypedDict, total=False):
    total: int
    in_progress: int
    pending: int
    tasks: List[OpenTask]
    trace_id: str


class HandoffContextResult(TypedDict, total=False):
    memory_id: str
    briefing_for: str
    recent_progress: List[str]
    open_tasks: List[HandoffTask]
    key_knowledge: List[HandoffKnowledge]
    token_estimate: int
    trace_id: str


class UpdateTaskResult(TypedDict, total=False):
    id: str
    memory_id: str
    title: str
    priority: str
    status: str
    updated_at: str


class MemoryProfileSection(TypedDict, total=False):
    title: str
    summary: str
    confidence: float
    category: str
    tags: List[str]


class MemoryProfile(TypedDict, total=False):
    user_preferences: List[MemoryProfileSection]
    key_decisions: List[MemoryProfileSection]
    core_knowledge: List[MemoryProfileSection]
    personal_context: List[MemoryProfileSection]
    active_risks: List[Dict[str, Any]]
    key_entities: List[str]
    card_count: int
    risk_count: int
    action_count: int
    generated_at: str


class DetectRoleResult(TypedDict, total=False):
    detected_role: str
    confidence: float
    available_roles: List[str]


class MemoryUsersResult(TypedDict, total=False):
    users: List[Dict[str, Any]]
    total: int


class ExtractionEvent(TypedDict, total=False):
    content: str
    event_type: str
    source: str


class ExistingCardRef(TypedDict, total=False):
    id: str
    title: str
    summary: str
    category: str


class ExistingTaskRef(TypedDict, total=False):
    """Open task reference included in extraction requests for auto-completion detection."""
    id: str
    title: str
    detail: str
    status: str
    priority: str


class ExtractionRequest(TypedDict, total=False):
    """Returned by remember_step/remember_batch when server triggers extraction.

    The SDK interceptor processes this automatically using the user's LLM.
    MCP Agents should process _extraction_instruction in the tool response.
    """
    memory_id: str
    session_id: str
    events: List[ExtractionEvent]
    existing_cards: List[ExistingCardRef]
    existing_tasks: List[ExistingTaskRef]
    system_prompt: str


class CompletedTask(TypedDict, total=False):
    """A task identified as completed by the LLM during insight extraction."""
    task_id: str
    reason: str


class SubmitInsightsResult(TypedDict, total=False):
    status: str
    memory_id: str
    cards_created: int
    cards_skipped_dup: int
    cards_updated: int
    risks_created: int
    action_items_created: int
    tasks_auto_completed: int


class AgentProfile(TypedDict, total=False):
    key: str
    title: str
    agent_role: str
    kind: str  # "agent" | "skill"
    responsibility: str
    when_to_use: str
    ingest_pattern: str
    recall_pattern: str
    identity: str
    critical_rules: List[str]
    workflow: str
    communication_style: str
    success_metrics: str
    system_prompt: str
    activation_prompt: str


class AgentListResult(TypedDict, total=False):
    agents: List[AgentProfile]
    total: int
