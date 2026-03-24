import type { PluginApi } from "./types";
import type { AwarenessClient } from "./client";

const LEGACY_FULL_TEXT_WEIGHT_KEY = ["full", "_text", "_weight"].join("");

// ---------------------------------------------------------------------------
// Register 6 OpenClaw tools backed by the Awareness REST API
// ---------------------------------------------------------------------------

export function registerTools(api: PluginApi, client: AwarenessClient): void {
  // -----------------------------------------------------------------------
  // 0. __awareness_workflow__ — workflow checklist (callable)
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "__awareness_workflow__",
    name: "__awareness_workflow__",
    description:
      "Call this when you're unsure what to do next with Awareness memory tools.\n" +
      "Returns a step-by-step checklist so you always know the right next action.\n" +
      "Low-cost call — use it anytime you need a reminder of the workflow.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => ({
      workflow: [
        { step: 1, action: "awareness_init", when: "FIRST thing every session", what: "Get session_id + past context" },
        { step: 2, action: "awareness_recall", when: "BEFORE starting work", what: "Search memory for relevant past context" },
        { step: 3, action: "awareness_record", when: "AFTER every change", what: 'awareness_record(action="write", content=<detailed description with reasoning, code snippets, files changed>)' },
        { step: 4, action: "handle _extraction_instruction", when: "response contains _extraction_instruction", what: 'Extract insights, then call awareness_record(action="write", content="summary", insights=<json>)', warning: "Skipping = NO searchable knowledge cards" },
      ],
      tips: {
        recall_vs_lookup: "awareness_recall = search by meaning. awareness_lookup = get by type (<50ms).",
        session_end: 'Call awareness_record(action="write", content=[...array of summaries...]) for batch recording.',
      },
    }),
  });

  // -----------------------------------------------------------------------
  // 1. awareness_init — initialize session and load cross-session project memory
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_init",
    name: "awareness_init",
    description:
      "Start here — call ONCE at session start to load persistent memory.\n\n" +
      "WHY: Without this, you have no memory of past sessions.\n" +
      "RETURNS: session_id, recent summaries, open tasks, knowledge cards.\n" +
      "If response contains _setup_action, you MUST follow it to write rules.\n" +
      "AFTER THIS: call awareness_recall to check for relevant past context.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          description: "Number of days to look back for context (default 7, max 90).",
          default: 7,
        },
        max_cards: {
          type: "integer",
          description: "Maximum knowledge cards to include (default 20).",
          default: 20,
        },
        max_tasks: {
          type: "integer",
          description: "Maximum tasks to include (default 20).",
          default: 20,
        },
        user_id: {
          type: "string",
          description: "Filter context by user ID (multi-user memory).",
        },
      },
    },
    execute: async (input) => {
      const days = input.days !== undefined ? Number(input.days) : undefined;
      const maxCards = input.max_cards !== undefined ? Number(input.max_cards) : undefined;
      const maxTasks = input.max_tasks !== undefined ? Number(input.max_tasks) : undefined;
      return client.init(days, maxCards, maxTasks);
    },
  });

  // -----------------------------------------------------------------------
  // 1.5. awareness_get_agent_prompt — fetch sub-agent activation prompt
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_get_agent_prompt",
    name: "awareness_get_agent_prompt",
    description:
      "Fetch the full activation prompt for a specific agent role (sub-agent spawning).\n\n" +
      "Call BEFORE spawning a sub-agent to get its dedicated system prompt.\n" +
      "Use the returned activation_prompt as the sub-agent's system prompt so that\n" +
      "the main agent context stays clean and each sub-agent has an isolated, focused prompt.\n\n" +
      "Typical usage:\n" +
      "1. awareness_init returns agent_profiles with slim summaries.\n" +
      "2. When a task matches a role, call awareness_get_agent_prompt(agent_role='<role>').\n" +
      "3. Spawn a sub-agent with the returned activation_prompt as its system prompt.\n" +
      "4. The sub-agent passes agent_role='<role>' to all awareness_* calls for memory isolation.",
    inputSchema: {
      type: "object",
      properties: {
        agent_role: {
          type: "string",
          description: "The agent role to fetch (e.g. 'developer_agent', 'reviewer_agent').",
        },
      },
      required: ["agent_role"],
    },
    execute: async (input) => {
      return client.getAgentPrompt(String(input.agent_role ?? ""));
    },
  });

  // -----------------------------------------------------------------------
  // 2. awareness_recall — cross-session recall with client-side query rewriting
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_recall",
    name: "awareness_recall",
    description:
      "Search persistent memory for past decisions, solutions, and knowledge.\n\n" +
      "Call BEFORE starting work to avoid re-solving solved problems.\n" +
      "Usage: awareness_recall(semantic_query=\"How was auth implemented?\", keyword_query=\"auth JWT\")\n" +
      "Just provide semantic_query for most tasks — defaults handle the rest.",
    inputSchema: {
      type: "object",
      properties: {
        semantic_query: {
          type: "string",
          description: "Expanded natural-language question for vector search.",
        },
        keyword_query: {
          type: "string",
          description: "2-5 precise terms for full-text matching (file names, function names, error codes).",
        },
        scope: {
          type: "string",
          enum: ["all", "timeline", "knowledge", "insights"],
          description: "Layer to search: all (default), timeline, knowledge, or insights.",
          default: "all",
        },
        limit: {
          type: "integer",
          description: "Maximum results (default 6, max 30).",
          default: 6,
        },
        vector_weight: {
          type: "number",
          description: "Weight for vector search in hybrid mode (default 0.7).",
          default: 0.7,
        },
        bm25_weight: {
          type: "number",
          description: "Weight for BM25 keyword search in hybrid mode (default 0.3).",
          default: 0.3,
        },
        recall_mode: {
          type: "string",
          enum: ["precise", "session", "structured", "hybrid", "auto"],
          description:
            "Recall strategy: hybrid (DB + top vectors, default), auto, precise (chunks only), " +
            "session (expand to full sessions), structured (zero vector, DB-only, ~1-2k tokens).",
          default: "hybrid",
        },
        multi_level: {
          type: "boolean",
          description: "Enable broader context retrieval across sessions and time ranges.",
        },
        cluster_expand: {
          type: "boolean",
          description: "Enable topic-based context expansion for deeper exploration.",
        },
        confidence_threshold: {
          type: "number",
          description: "Minimum confidence threshold for structured/hybrid cards (0-1).",
        },
        include_installed: {
          type: "boolean",
          description: "Search installed marketplace memories in addition to primary memory (default true).",
        },
        user_id: {
          type: "string",
          description: "Filter results by user ID (multi-user memory).",
        },
        agent_role: {
          type: "string",
          description: "Override agent role for scoped recall (defaults to plugin config).",
        },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description:
            "Progressive disclosure mode. " +
            "'summary' = lightweight index (~50-100 tokens each, returns title/summary/score/tokens_est). " +
            "'full' = complete content for items specified in 'ids' (from a prior summary call).",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Item IDs to expand (used with detail='full'). IDs come from a prior detail='summary' call.",
        },
      },
      required: ["semantic_query"],
    },
    execute: async (input) => {
      const legacyFullTextWeight = input[LEGACY_FULL_TEXT_WEIGHT_KEY];
      return client.search({
        semanticQuery: String(input.semantic_query ?? ""),
        keywordQuery: input.keyword_query !== undefined ? String(input.keyword_query) : undefined,
        scope: (input.scope as "all" | "timeline" | "knowledge" | "insights") ?? "all",
        limit: input.limit !== undefined ? Number(input.limit) : undefined,
        vectorWeight: input.vector_weight !== undefined ? Number(input.vector_weight) : undefined,
        bm25Weight:
          input.bm25_weight !== undefined
            ? Number(input.bm25_weight)
            : legacyFullTextWeight !== undefined
              ? Number(legacyFullTextWeight)
              : undefined,
        recallMode: (input.recall_mode as "precise" | "session" | "structured" | "hybrid" | "auto") ?? "auto",
        multiLevel: input.multi_level !== undefined ? Boolean(input.multi_level) : undefined,
        clusterExpand: input.cluster_expand !== undefined ? Boolean(input.cluster_expand) : undefined,
        confidenceThreshold: input.confidence_threshold !== undefined ? Number(input.confidence_threshold) : undefined,
        includeInstalled: input.include_installed !== undefined ? Boolean(input.include_installed) : true,
        userId: input.user_id !== undefined ? String(input.user_id) : undefined,
        agentRole: input.agent_role !== undefined ? String(input.agent_role) : undefined,
        detail: input.detail !== undefined ? String(input.detail) as "summary" | "full" : undefined,
        ids: Array.isArray(input.ids) ? (input.ids as unknown[]).map(String) : undefined,
      });
    },
  });

  // -----------------------------------------------------------------------
  // 3. awareness_lookup — structured data retrieval (no vector search)
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_lookup",
    name: "awareness_lookup",
    description:
      "Fast DB lookup — use instead of awareness_recall when you know WHAT you want.\n" +
      "awareness_recall = search by meaning (semantic). awareness_lookup = get by type (<50ms).\n" +
      "Examples: type=\"tasks\" for open tasks, type=\"knowledge\" for cards, type=\"risks\" for risks.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["context", "tasks", "knowledge", "risks", "session_history", "timeline", "handoff", "rules", "graph", "agents"],
          description: "Type of data to retrieve.",
        },
        query: { type: "string", description: "Keyword filter for knowledge cards (not vector search)." },
        category: { type: "string", description: "Category filter for knowledge cards." },
        status: { type: "string", description: "Status filter (e.g., pending, in_progress, completed)." },
        priority: { type: "string", description: "Priority filter for tasks (high, medium, low)." },
        include_completed: { type: "boolean", description: "Include completed tasks (default false).", default: false },
        level: { type: "string", description: "Risk level filter (high, medium, low)." },
        session_id: { type: "string", description: "Session ID for session_history type." },
        limit: { type: "integer", description: "Maximum items to return (default 50).", default: 50 },
        offset: { type: "integer", description: "Pagination offset (default 0).", default: 0 },
        user_id: { type: "string", description: "Filter by user ID (multi-user memory)." },
        format: { type: "string", description: "Output format for rules type (json, cursorrules, claude-md, markdown)." },
        entity_id: { type: "string", description: "Entity ID for graph neighbor lookup." },
        entity_type: { type: "string", description: "Entity type filter for graph lookup." },
        search: { type: "string", description: "Name search for graph entities." },
        max_hops: { type: "integer", description: "Traversal depth for graph neighbor lookup (1-4)." },
      },
      required: ["type"],
    },
    execute: async (input) => {
      return client.getData(
        String(input.type ?? "context"),
        input as Record<string, unknown>,
      );
    },
  });

  // -----------------------------------------------------------------------
  // 4. awareness_record — unified write (remember, batch, ingest, update, submit)
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_record",
    name: "awareness_record",
    description:
      "Save what you did/decided/learned to persistent memory.\n\n" +
      "Call AFTER every meaningful action. If you don't record it, it's lost.\n" +
      "PRIMARY: awareness_record(action=\"write\", content=<detailed description with reasoning, code snippets, files>)\n" +
      "BATCH: awareness_record(action=\"write\", content=[\"step1\", \"step2\", ...])\n" +
      "WITH INSIGHTS: awareness_record(action=\"write\", content=\"summary\", insights={...})\n\n" +
      "CRITICAL: When response contains _extraction_instruction, you MUST follow it\n" +
      "to extract insights, then call awareness_record(action=\"write\", content=\"summary\", insights=<json>).\n" +
      "Skipping = raw events stored but NO searchable knowledge cards created.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["write", "update_task"],
          description: "Write action to perform.",
        },
        content: {
          type: "string",
          description: "Content to record. String for single event, JSON-stringified array for batch. Falls back to 'text' param for legacy compatibility.",
        },
        text: { type: "string", description: "Text content (legacy alias for content)." },
        task_id: { type: "string", description: "Task ID for update_task action." },
        status: { type: "string", description: "New status for update_task (completed, in_progress, pending)." },
        metadata: {
          type: "object",
          description: "Additional metadata to attach to events.",
        },
        user_id: {
          type: "string",
          description: "User ID for multi-user memory attribution.",
        },
        insights: {
          type: "object",
          description: "Pre-extracted structured insights to store with this event. Include knowledge_cards, action_items, risks, completed_tasks. When provided, skips the _extraction_instruction round-trip.",
        },
      },
      required: ["action"],
    },
    execute: async (input) => {
      return client.write(
        String(input.action ?? "remember"),
        input as Record<string, unknown>,
      );
    },
  });
}
