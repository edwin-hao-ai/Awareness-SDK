import type { PluginApi } from "./types";
import type { AwarenessClient } from "./client";

// ---------------------------------------------------------------------------
// Register 4 OpenClaw tools backed by the Awareness REST API
// ---------------------------------------------------------------------------

export function registerTools(api: PluginApi, client: AwarenessClient): void {
  // -----------------------------------------------------------------------
  // 0. __awareness_workflow__ — persistent workflow reference (meta-tool)
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "__awareness_workflow__",
    description:
      "DO NOT CALL — read this workflow reference.\n\n" +
      "MANDATORY STEPS (follow in order):\n\n" +
      "1. SESSION START → awareness_init()\n" +
      "   Get session_id. Review returned context before working.\n\n" +
      "2. BEFORE WORK → awareness_recall(semantic_query=..., keyword_query=...)\n" +
      "   Search persistent memory for relevant past decisions/context.\n\n" +
      "3. AFTER EVERY CHANGE → awareness_record(action=\"remember\", text=...)\n" +
      "   Record EVERY code edit, decision, bug fix. Include WHAT/WHY/OUTCOME/FILES.\n" +
      "   Skipping this = permanent data loss.\n\n" +
      "4. IF _extraction_instruction RETURNED → Process with LLM, then:\n" +
      "   awareness_record(action=\"submit_insights\", content=<result>)\n\n" +
      "5. SESSION END → awareness_record(action=\"remember_batch\", steps=[...])\n" +
      "   Final summary: decisions, changed files, blockers, TODOs.\n\n" +
      "awareness_* = cross-session persistent memory (past decisions, knowledge)\n" +
      "Other tools = current codebase navigation (file search, code index)\n" +
      "Use BOTH — they serve different purposes.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => ({ message: "Reference-only tool. See the description for workflow." }),
  });

  // -----------------------------------------------------------------------
  // 1. awareness_init — initialize session and load cross-session project memory
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_init",
    description:
      "Load cross-session project memory — NOT local code search. " +
      "MUST call ONCE at session start. Returns session_id (pass to all " +
      "subsequent awareness_record calls), recent narratives, open tasks, " +
      "and knowledge cards. Use alongside code search tools — they complement each other.",
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
  // 2. awareness_recall — cross-session recall with client-side query rewriting
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_recall",
    description:
      "Search cross-session persistent memory — past decisions, knowledge, history.\n\n" +
      "Rewrite query before calling: semantic_query=full question, keyword_query=2-5 precise terms.\n" +
      "See __awareness_workflow__ STEP 2 for when to call.\n\n" +
      "Recall modes: auto (default) | precise | session | structured | hybrid.",
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
          description: "Weight for full-text search in hybrid mode (default 0.3).",
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
          description: "Search installed marketplace memories in addition to primary memory.",
        },
        user_id: {
          type: "string",
          description: "Filter results by user ID (multi-user memory).",
        },
      },
      required: ["semantic_query"],
    },
    execute: async (input) => {
      return client.search({
        semanticQuery: String(input.semantic_query ?? ""),
        keywordQuery: input.keyword_query !== undefined ? String(input.keyword_query) : undefined,
        scope: (input.scope as "all" | "timeline" | "knowledge" | "insights") ?? "all",
        limit: input.limit !== undefined ? Number(input.limit) : undefined,
        vectorWeight: input.vector_weight !== undefined ? Number(input.vector_weight) : undefined,
        bm25Weight: input.bm25_weight !== undefined ? Number(input.bm25_weight) : undefined,
        recallMode: (input.recall_mode as "precise" | "session" | "structured" | "hybrid" | "auto") ?? "auto",
        multiLevel: input.multi_level !== undefined ? Boolean(input.multi_level) : undefined,
        clusterExpand: input.cluster_expand !== undefined ? Boolean(input.cluster_expand) : undefined,
        confidenceThreshold: input.confidence_threshold !== undefined ? Number(input.confidence_threshold) : undefined,
        includeInstalled: input.include_installed !== undefined ? Boolean(input.include_installed) : undefined,
        userId: input.user_id !== undefined ? String(input.user_id) : undefined,
      });
    },
  });

  // -----------------------------------------------------------------------
  // 3. awareness_lookup — structured data retrieval (no vector search)
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_lookup",
    description:
      "Look up structured data from persistent memory — pure DB, <50ms.\n" +
      "TYPE: context | tasks | knowledge | risks | session_history | timeline | handoff | rules | graph | agents",
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
    description:
      "Record events to cross-session persistent memory. See __awareness_workflow__ STEP 3.\n\n" +
      "ACTIONS: remember (single event) | remember_batch (session-end summary) | " +
      "backfill | ingest | update_task | submit_insights\n\n" +
      "Include WHAT/WHY/OUTCOME/FILES in text. If response has _extraction_instruction: process → submit_insights.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["remember", "remember_batch", "backfill", "ingest", "update_task", "submit_insights"],
          description: "Write action to perform.",
        },
        text: { type: "string", description: "Text content for remember action." },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: { text: { type: "string" } },
          },
          description: "Array of {text} objects for remember_batch.",
        },
        content: {
          description: "Content for ingest action (string, array, or object).",
        },
        content_scope: {
          type: "string",
          enum: ["timeline", "knowledge"],
          description: "Content scope for ingest (default timeline).",
          default: "timeline",
        },
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
        history: {
          description: "Conversation log for backfill action (array of {role, content}).",
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
