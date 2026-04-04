import type {
  RecallResult,
  SessionContext,
  SessionHistoryResult,
  KnowledgeBaseResponse,
  ActionItemsResponse,
  RisksResponse,
  IngestResponse,
  SupersedeResponse,
  VectorResult,
} from "./types";

const LEGACY_FULL_TEXT_WEIGHT_KEY = ["full", "_text", "_weight"].join("");

function buildRecallContent(result: {
  type?: string;
  title?: string;
  summary?: string;
  content?: string;
}): string {
  if (result.content) return result.content;
  const prefix = result.type ? `[${result.type}] ` : "";
  const title = result.title || "";
  const summary = result.summary || "";
  if (title && summary) return `${prefix}${title}\n${summary}`;
  return `${prefix}${title || summary}`.trim();
}

function parseRecallSummaryBlocks(
  summaryText: string,
  ids: string[] = [],
): VectorResult[] {
  const cleaned = summaryText.replace(/^Found \d+ memories:\n\n/, "").trim();
  if (!cleaned) return [];

  const chunks = cleaned
    .split(/\n\n(?=\d+\.\s+\[[^\]]*\]\s+)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const results: VectorResult[] = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const match = chunk.match(/^\d+\.\s+\[([^\]]*)\]\s+([^\n]+?)(?:\s+\([^)]*\))?(?:\n\s+([\s\S]*))?$/);
    if (!match) {
      results.push({
        id: ids[index],
        content: chunk,
      });
      continue;
    }

    const [, type, rawTitle, rawSummary = ""] = match;
    // Strip trailing metadata like (85%, 3d ago, ~120tok) from title
    const title = rawTitle.replace(/\s*\([^)]*%[^)]*\)\s*$/, "").trim();
    const summary = rawSummary.trim();
    const result: VectorResult = {
      id: ids[index],
      type: type || undefined,
      title: title.trim(),
      summary: summary || undefined,
    };
    result.content = buildRecallContent(result);
    results.push(result);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Search options for the awareness_recall interface
// ---------------------------------------------------------------------------

export interface SearchOptions {
  semanticQuery: string;
  keywordQuery?: string;
  scope?: "all" | "timeline" | "knowledge" | "insights";
  limit?: number;
  vectorWeight?: number;
  bm25Weight?: number;
  recallMode?: "precise" | "session" | "structured" | "hybrid" | "auto";
  /** Enable broader context retrieval across sessions and time ranges. */
  multiLevel?: boolean;
  /** Enable topic-based context expansion for deeper exploration. */
  clusterExpand?: boolean;
  /** Minimum confidence threshold for structured/hybrid cards. */
  confidenceThreshold?: number;
  /** Search installed marketplace memories (default true to match server). */
  includeInstalled?: boolean;
  /** Multi-user filtering. */
  userId?: string;
  /** Override agent role per-call (defaults to plugin config). */
  agentRole?: string;
  /** Progressive disclosure: 'summary' for lightweight index, 'full' for complete content of specified ids. */
  detail?: "summary" | "full";
  /** Item IDs to expand (used with detail='full'). IDs come from a prior detail='summary' call. */
  ids?: string[];
  /** Exclude memories from these sources (e.g. ['mcp'] to hide Claude Code dev memories during chat recall). */
  sourceExclude?: string[];
}

// ---------------------------------------------------------------------------
// AwarenessClient — thin HTTP wrapper around the Awareness REST API
// Supports both cloud REST and local daemon MCP JSON-RPC transparently.
// ---------------------------------------------------------------------------

export class AwarenessClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly memoryId: string;
  private readonly agentRole: string | undefined;
  readonly sessionId: string;
  /** True when connected to the local daemon (no apiKey + localhost). */
  readonly isLocal: boolean;
  /** Origin for local MCP calls (e.g. http://localhost:37800). */
  private readonly localOrigin: string;

  constructor(
    baseUrl: string,
    apiKey: string,
    memoryId: string,
    agentRole?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.memoryId = memoryId;
    this.agentRole = agentRole;
    this.sessionId = `openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Detect local mode: empty apiKey + localhost URL
    this.isLocal = !apiKey && /localhost|127\.0\.0\.1/.test(baseUrl);
    // Strip /api/v1 suffix to get the daemon origin for MCP calls
    this.localOrigin = baseUrl.replace(/\/api\/v1\/?$/, "");
  }

  // -----------------------------------------------------------------------
  // Local MCP JSON-RPC helper
  // -----------------------------------------------------------------------

  /**
   * Call a daemon MCP tool via the /mcp Streamable HTTP endpoint.
   * Returns the parsed JSON from the first text content block.
   */
  private async mcpCall<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.localOrigin}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    if (!response.ok) {
      throw new Error(`MCP call ${toolName} failed (${response.status})`);
    }
    const rpc = (await response.json()) as Record<string, unknown>;
    if (rpc.error) {
      const err = rpc.error as Record<string, unknown>;
      throw new Error(`MCP ${toolName}: ${err.message ?? JSON.stringify(err)}`);
    }
    const result = rpc.result as Record<string, unknown>;
    const content = result?.content as Array<{ type: string; text: string }> | undefined;
    if (!content || content.length === 0) return {} as T;
    const text = content[0].text;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) throw new Error(`MCP ${toolName}: ${parsed.error}`);
      return parsed as T;
    } catch {
      // Not JSON — return as-is wrapped
      return { raw: text } as unknown as T;
    }
  }

  /**
   * Call MCP recall and return all content blocks (summary mode returns 2 blocks).
   */
  private async mcpCallRaw(toolName: string, args: Record<string, unknown>): Promise<Array<{ type: string; text: string }>> {
    const response = await fetch(`${this.localOrigin}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });
    if (!response.ok) {
      throw new Error(`MCP call ${toolName} failed (${response.status})`);
    }
    const rpc = (await response.json()) as Record<string, unknown>;
    if (rpc.error) {
      const err = rpc.error as Record<string, unknown>;
      throw new Error(`MCP ${toolName}: ${err.message ?? JSON.stringify(err)}`);
    }
    const result = rpc.result as Record<string, unknown>;
    return (result?.content ?? []) as Array<{ type: string; text: string }>;
  }

  // -----------------------------------------------------------------------
  // 1. awareness_init — session initialization + context loading
  // -----------------------------------------------------------------------

  async init(
    days?: number,
    maxCards?: number,
    maxTasks?: number,
    query?: string,
  ): Promise<{ session_id: string; context: SessionContext }> {
    const ctx = await this.getSessionContext(days, maxCards, maxTasks, query);
    return {
      session_id: this.sessionId,
      context: ctx,
    };
  }

  // -----------------------------------------------------------------------
  // 2. awareness_recall — semantic search with separate keyword query
  // -----------------------------------------------------------------------

  async search(opts: SearchOptions): Promise<RecallResult> {
    if (this.isLocal) {
      return this.localSearch(opts);
    }

    const query = opts.semanticQuery;
    const legacyFullTextWeight = (opts as unknown as Record<string, unknown>)[LEGACY_FULL_TEXT_WEIGHT_KEY];

    const customKwargs: Record<string, unknown> = {
      limit: Math.max(1, Math.min(opts.limit ?? 6, 30)),
      use_hybrid_search: true,
      reconstruct_chunks: true,
      recall_mode: opts.recallMode ?? "hybrid",
      vector_weight: opts.vectorWeight ?? 0.7,
      bm25_weight:
        opts.bm25Weight ??
        (typeof legacyFullTextWeight === "number" ? legacyFullTextWeight : undefined) ??
        0.3,
    };
    if (opts.multiLevel !== undefined) customKwargs.multi_level = opts.multiLevel;
    if (opts.clusterExpand !== undefined) customKwargs.cluster_expand = opts.clusterExpand;

    const body: Record<string, unknown> = { query, custom_kwargs: customKwargs };
    if (opts.confidenceThreshold !== undefined) body.confidence_threshold = opts.confidenceThreshold;
    const includeInstalled = opts.includeInstalled ?? true;
    body.include_installed = includeInstalled;
    if (opts.keywordQuery) {
      body.keyword_query = opts.keywordQuery;
    }
    if (opts.scope && opts.scope !== "all") {
      const scopeMap: Record<string, string[]> = {
        timeline: ["timeline"],
        knowledge: ["knowledge", "full_source"],
        insights: ["insight_summary"],
      };
      customKwargs.metadata_filter = {
        aw_content_scope: scopeMap[opts.scope],
      };
    }
    const agentRole = opts.agentRole ?? this.agentRole;
    if (agentRole) body.agent_role = agentRole;
    if (opts.userId) body.user_id = opts.userId;
    if (opts.detail) body.detail = opts.detail;
    if (opts.ids && opts.ids.length > 0) body.ids = opts.ids;
    return this.post<RecallResult>(
      `/memories/${this.memoryId}/retrieve`,
      body,
    );
  }

  /**
   * Local daemon search via MCP awareness_recall.
   * Converts the MCP two-block response into RecallResult format.
   */
  private async localSearch(opts: SearchOptions): Promise<RecallResult> {
    const args: Record<string, unknown> = {
      detail: opts.detail ?? "summary",
      limit: Math.max(1, Math.min(opts.limit ?? 6, 30)),
    };
    if (opts.semanticQuery) args.semantic_query = opts.semanticQuery;
    if (opts.keywordQuery) args.keyword_query = opts.keywordQuery;
    if (opts.ids && opts.ids.length > 0) args.ids = opts.ids;
    if (opts.scope) args.scope = opts.scope;
    if (opts.recallMode) args.recall_mode = opts.recallMode;
    const agentRole = opts.agentRole ?? this.agentRole;
    if (agentRole) args.agent_role = agentRole;
    if (opts.sourceExclude && opts.sourceExclude.length > 0) args.source_exclude = opts.sourceExclude;

    const blocks = await this.mcpCallRaw("awareness_recall", args);

    // Parse MCP response into RecallResult
    // summary mode: block[0] = readable text, block[1] = JSON {_ids, _meta}
    if (blocks.length === 0) return { results: [] };

    // Try to parse the first block as JSON (full mode or error)
    try {
      const parsed = JSON.parse(blocks[0].text);
      if (parsed.error) throw new Error(parsed.error);
      if (parsed.results) return parsed as RecallResult;
    } catch {
      // Not JSON — it's the readable summary text
    }

    const summaryText = blocks[0]?.text ?? "";
    let ids: string[] = [];
    try {
      const parsedMeta = JSON.parse(blocks[1]?.text ?? "{}");
      if (Array.isArray(parsedMeta._ids)) {
        ids = parsedMeta._ids.map((id: unknown) => String(id));
      }
    } catch {
      // No metadata block — keep best-effort parsing only
    }

    const results = parseRecallSummaryBlocks(summaryText, ids);

    // If regex didn't match (format changed), use the raw text as single result
    if (results.length === 0 && summaryText.length > 20) {
      results.push({ content: summaryText });
    }

    return { results };
  }

  // -----------------------------------------------------------------------
  // 3. awareness_lookup — structured data retrieval by type
  // -----------------------------------------------------------------------

  async getData(
    type: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    switch (type) {
      case "context":
        return this.getSessionContext(
          params.days !== undefined ? Number(params.days) : undefined,
          params.max_cards !== undefined ? Number(params.max_cards) : undefined,
          params.max_tasks !== undefined ? Number(params.max_tasks) : undefined,
        );

      case "tasks":
        return this.getPendingTasks(
          params.status !== undefined ? String(params.status) : undefined,
          params.priority !== undefined ? String(params.priority) : undefined,
          params.include_completed === true,
          params.limit !== undefined ? Number(params.limit) : undefined,
        );

      case "knowledge":
        return this.getKnowledgeBase(
          params.query !== undefined ? String(params.query) : undefined,
          params.category !== undefined ? String(params.category) : undefined,
          params.limit !== undefined ? Number(params.limit) : undefined,
        );

      case "risks":
        return this.getRisks(
          params.level !== undefined ? String(params.level) : undefined,
          params.status !== undefined ? String(params.status) : undefined,
          params.limit !== undefined ? Number(params.limit) : undefined,
        );

      case "session_history":
        if (!params.session_id) {
          return { error: "session_id is required for type='session_history'." };
        }
        return this.getSessionHistory(
          String(params.session_id),
          params.limit !== undefined ? Number(params.limit) : undefined,
        );

      case "timeline":
        return this.getTimeline(
          params.limit !== undefined ? Number(params.limit) : undefined,
          params.offset !== undefined ? Number(params.offset) : undefined,
          params.session_id !== undefined ? String(params.session_id) : undefined,
        );

      case "handoff":
        return this.getHandoffContext(
          params.query !== undefined ? String(params.query) : undefined,
        );

      case "rules":
        return this.getRules(params);

      case "graph":
        return this.getGraph(params);

      case "agents":
        return this.getAgents();

      default:
        return { error: `Unknown type: ${type}` };
    }
  }

  // -----------------------------------------------------------------------
  // 4. awareness_record — unified write dispatcher
  // -----------------------------------------------------------------------

  async write(
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    const userId = params.user_id !== undefined ? String(params.user_id) : undefined;
    switch (action) {
      case "write": {
        const content = params.content ?? params.text ?? "";
        const insights = params.insights as Record<string, unknown> | undefined;
        if (Array.isArray(content)) {
          const steps = content.map((s: unknown) =>
            typeof s === "string" ? s : String((s as Record<string, unknown>).content ?? s),
          );
          const result = await this.rememberBatch(steps, userId);
          if (insights) {
            const insightsResult = await this.submitInsights(insights);
            return { ...result as Record<string, unknown>, insights_result: insightsResult };
          }
          return result;
        }
        const result = await this.record(
          String(content),
          params.metadata as Record<string, unknown> | undefined,
          userId,
          insights,
        );
        return result;
      }

      case "update_task":
        return this.updateTask(
          String(params.task_id ?? ""),
          String(params.status ?? "completed"),
        );

      default:
        return { error: `Unknown action: ${action}` };
    }
  }

  // -----------------------------------------------------------------------
  // Internal — Context & Insights
  // -----------------------------------------------------------------------

  private async getSessionContext(
    days?: number,
    maxCards?: number,
    maxTasks?: number,
    query?: string,
  ): Promise<SessionContext> {
    if (this.isLocal) {
      // Use MCP awareness_init which returns full session context
      const raw = await this.mcpCall<Record<string, unknown>>("awareness_init", {
        source: "openclaw-plugin",
        days: days ?? 7,
        max_cards: maxCards ?? 8,
        max_tasks: maxTasks ?? 8,
        ...(query && { query }),
      });
      // Map MCP response to SessionContext interface
      return {
        user_preferences: raw.user_preferences as SessionContext["user_preferences"],
        knowledge_cards: raw.knowledge_cards as SessionContext["knowledge_cards"],
        open_tasks: raw.open_tasks as SessionContext["open_tasks"],
        recent_days: raw.recent_days as SessionContext["recent_days"],
        last_sessions: raw.recent_sessions as SessionContext["last_sessions"],
        active_skills: raw.active_skills as SessionContext["active_skills"],
        attention_summary: raw.attention_summary as SessionContext["attention_summary"],
        rendered_context: raw.rendered_context as string | undefined,
      };
    }

    const params = new URLSearchParams();
    if (days !== undefined) params.set("days", String(days));
    if (maxCards !== undefined) params.set("max_cards", String(maxCards));
    if (maxTasks !== undefined) params.set("max_tasks", String(maxTasks));
    if (query) params.set("query", query);
    if (this.agentRole) params.set("agent_role", this.agentRole);
    return this.get<SessionContext>(
      `/memories/${this.memoryId}/context`,
      params,
    );
  }

  private async getKnowledgeBase(
    query?: string,
    category?: string,
    limit?: number,
  ): Promise<KnowledgeBaseResponse> {
    if (this.isLocal) {
      const result = await this.mcpCall<Record<string, unknown>>("awareness_lookup", {
        type: "knowledge",
        ...(query && { query }),
        ...(category && { category }),
        ...(limit !== undefined && { limit }),
      });
      return {
        cards: result.knowledge_cards as KnowledgeBaseResponse["cards"],
        total: result.total as number,
      };
    }

    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (category) params.set("category", category);
    if (limit !== undefined) params.set("limit", String(limit));
    if (this.agentRole) params.set("agent_role", this.agentRole);
    return this.get<KnowledgeBaseResponse>(
      `/memories/${this.memoryId}/insights/knowledge-cards`,
      params,
    );
  }

  private async getPendingTasks(
    status?: string,
    priority?: string,
    _includeCompleted?: boolean,
    limit?: number,
  ): Promise<ActionItemsResponse> {
    if (this.isLocal) {
      const result = await this.mcpCall<Record<string, unknown>>("awareness_lookup", {
        type: "tasks",
        ...(status && { status }),
        ...(priority && { priority }),
        ...(limit !== undefined && { limit }),
      });
      return {
        action_items: result.tasks as ActionItemsResponse["action_items"],
        total: result.total as number,
      };
    }

    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (limit !== undefined) params.set("limit", String(limit));
    if (this.agentRole) params.set("agent_role", this.agentRole);
    return this.get<ActionItemsResponse>(
      `/memories/${this.memoryId}/insights/action-items`,
      params,
    );
  }

  private async getRisks(
    level?: string,
    status?: string,
    limit?: number,
  ): Promise<RisksResponse> {
    if (this.isLocal) {
      const result = await this.mcpCall<Record<string, unknown>>("awareness_lookup", {
        type: "risks",
        ...(level && { level }),
        ...(status && { status }),
        ...(limit !== undefined && { limit }),
      });
      return {
        risks: result.risks as RisksResponse["risks"],
        total: result.total as number,
      };
    }

    const params = new URLSearchParams();
    if (level) params.set("level", level);
    if (status) params.set("status", status);
    if (limit !== undefined) params.set("limit", String(limit));
    if (this.agentRole) params.set("agent_role", this.agentRole);
    return this.get<RisksResponse>(
      `/memories/${this.memoryId}/insights/risks`,
      params,
    );
  }

  private async getSessionHistory(
    sessionId: string,
    limit?: number,
  ): Promise<SessionHistoryResult> {
    if (this.isLocal) {
      const result = await this.mcpCall<Record<string, unknown>>("awareness_lookup", {
        type: "session_history",
        session_id: sessionId,
        ...(limit !== undefined && { limit }),
      });
      return {
        memory_id: this.memoryId,
        session_id: sessionId,
        event_count: (result.sessions as unknown[])?.length ?? 0,
        events: result.sessions as SessionHistoryResult["events"],
      };
    }

    const params = new URLSearchParams({
      session_id: sessionId,
      limit: String(Math.max(1, Math.min(limit ?? 100, 500))),
    });
    const raw = await this.get<unknown>(
      `/memories/${this.memoryId}/content`,
      params,
    );
    const arr = Array.isArray(raw)
      ? raw
      : ((raw as Record<string, unknown>)?.["items"] ?? []);
    const items = (arr as Record<string, unknown>[]).sort((a, b) => {
      const ts = (item: Record<string, unknown>) => {
        for (const k of ["aw_time_iso", "event_timestamp", "created_at"]) {
          const v = item[k];
          if (v) return String(v);
        }
        return "";
      };
      return ts(a).localeCompare(ts(b));
    });
    return {
      memory_id: this.memoryId,
      session_id: sessionId,
      event_count: items.length,
      events: items,
    };
  }

  private async getTimeline(
    limit?: number,
    offset?: number,
    sessionId?: string,
  ): Promise<unknown> {
    if (this.isLocal) {
      return this.mcpCall<unknown>("awareness_lookup", {
        type: "timeline",
        ...(limit !== undefined && { limit }),
        ...(offset !== undefined && { offset }),
        ...(sessionId && { session_id: sessionId }),
      });
    }

    const params = new URLSearchParams();
    if (limit !== undefined) params.set("limit", String(limit));
    if (offset !== undefined) params.set("offset", String(offset));
    if (sessionId) params.set("session_id", sessionId);
    params.set("include_summaries", "true");
    return this.get<unknown>(
      `/memories/${this.memoryId}/timeline`,
      params,
    );
  }

  private async getHandoffContext(query?: string): Promise<unknown> {
    // Reuses getSessionContext which already handles local/cloud routing
    const ctx = await this.getSessionContext(3, 5, 10);
    return {
      memory_id: this.memoryId,
      briefing_for: query || "Continue previous work",
      recent_progress: (ctx.recent_days ?? [])
        .filter((d) => d.narrative)
        .map((d) => `${d.date}: ${(d.narrative ?? "").slice(0, 300)}`),
      open_tasks: (ctx.open_tasks ?? []).map((t) => ({
        title: t.title,
        priority: t.priority,
        status: t.status,
      })),
      key_knowledge: (ctx.knowledge_cards ?? []).map((c) => ({
        title: c.title,
        summary: (c.summary ?? "").slice(0, 200),
      })),
    };
  }

  private async getRules(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.isLocal) {
      // Local daemon doesn't have /rules endpoint; return empty
      return { rules: [], mode: "local" };
    }
    const qs = new URLSearchParams();
    if (params.format !== undefined) qs.set("format", String(params.format));
    if (this.agentRole) qs.set("agent_role", this.agentRole);
    return this.get<unknown>(`/memories/${this.memoryId}/rules`, qs);
  }

  private async getGraph(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.isLocal) {
      // Local daemon doesn't have graph endpoints
      return { entities: [], mode: "local" };
    }
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.entity_type !== undefined) qs.set("entity_type", String(params.entity_type));
    if (params.search !== undefined) qs.set("search", String(params.search));
    if (params.entity_id) {
      if (params.max_hops !== undefined) qs.set("max_hops", String(params.max_hops));
      return this.get<unknown>(
        `/memories/${this.memoryId}/graph/entities/${String(params.entity_id)}/neighbors`,
        qs,
      );
    }
    return this.get<unknown>(`/memories/${this.memoryId}/graph/entities`, qs);
  }

  private async getAgents(): Promise<unknown> {
    if (this.isLocal) {
      return { agents: [], mode: "local" };
    }
    return this.get<unknown>(`/memories/${this.memoryId}/agents`);
  }

  async getAgentPrompt(agentRole: string): Promise<unknown> {
    if (this.isLocal) {
      return this.mcpCall<unknown>("awareness_get_agent_prompt", { role: agentRole });
    }
    const params = new URLSearchParams({ agent_role: agentRole });
    return this.get<unknown>(
      `/memories/${this.memoryId}/agents/prompt`,
      params,
    );
  }

  // -----------------------------------------------------------------------
  // Internal — Write operations
  // -----------------------------------------------------------------------

  async record(
    text: string,
    metadata?: Record<string, unknown>,
    userId?: string,
    insights?: Record<string, unknown>,
  ): Promise<IngestResponse> {
    if (this.isLocal) {
      const args: Record<string, unknown> = {
        action: "remember",
        content: text,
        session_id: this.sessionId,
      };
      if (this.agentRole) args.agent_role = this.agentRole;
      if (userId) args.user_id = userId;
      if (insights) args.insights = insights;
      if (metadata) {
        if (metadata.event_type) args.event_type = metadata.event_type;
        if (metadata.source) args.source = metadata.source;
        if (metadata.tags) args.tags = metadata.tags;
      }
      return this.mcpCall<IngestResponse>("awareness_record", args);
    }

    const body: Record<string, unknown> = {
      memory_id: this.memoryId,
      content: text,
      session_id: this.sessionId,
    };
    if (this.agentRole) body.agent_role = this.agentRole;
    if (userId) body.user_id = userId;
    if (insights) body.insights = insights;
    if (metadata) Object.assign(body, metadata);
    return this.post<IngestResponse>("/mcp/events", body);
  }

  private async rememberBatch(
    steps: string[],
    userId?: string,
  ): Promise<IngestResponse> {
    if (this.isLocal) {
      const items = steps.map((content) => ({ content }));
      const args: Record<string, unknown> = {
        action: "remember_batch",
        items,
        session_id: this.sessionId,
      };
      if (this.agentRole) args.agent_role = this.agentRole;
      if (userId) args.user_id = userId;
      return this.mcpCall<IngestResponse>("awareness_record", args);
    }

    const body: Record<string, unknown> = {
      memory_id: this.memoryId,
      steps,
      session_id: this.sessionId,
    };
    if (this.agentRole) body.agent_role = this.agentRole;
    if (userId) body.user_id = userId;
    return this.post<IngestResponse>("/mcp/events/batch", body);
  }

  private async ingestContent(
    content: unknown,
    contentScope: string,
    metadata?: Record<string, unknown>,
  ): Promise<IngestResponse> {
    if (this.isLocal) {
      // For local, ingest as a regular record with event_type
      return this.record(
        typeof content === "string" ? content : JSON.stringify(content),
        { event_type: contentScope, ...(metadata ?? {}) },
      );
    }

    const body: Record<string, unknown> = {
      memory_id: this.memoryId,
      content,
      content_scope: contentScope,
      session_id: this.sessionId,
    };
    if (this.agentRole) body.agent_role = this.agentRole;
    if (metadata) body.metadata = metadata;
    return this.post<IngestResponse>("/mcp/events", body);
  }

  private async updateTask(
    taskId: string,
    status: string,
  ): Promise<unknown> {
    if (this.isLocal) {
      return this.mcpCall<unknown>("awareness_record", {
        action: "update_task",
        task_id: taskId,
        status,
      });
    }

    return this.patch<unknown>(
      `/memories/${this.memoryId}/insights/action-items/${taskId}`,
      { status },
    );
  }

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  async closeSession(): Promise<{ session_id: string; events_processed: number }> {
    if (this.isLocal) {
      // Local daemon doesn't do insight extraction on session close,
      // so skip the sentinel record — it's just noise in the timeline.
      return { session_id: this.sessionId, events_processed: 0 };
    }

    const body: Record<string, unknown> = {
      memory_id: this.memoryId,
      session_id: this.sessionId,
      generate_summary: true,
    };
    if (this.agentRole) body.agent_role = this.agentRole;
    try {
      return await this.post<{ session_id: string; events_processed: number }>(
        "/mcp/events/batch",
        { ...body, steps: [], close_session: true },
      );
    } catch {
      await this.record("[session-end]", {
        event_type: "session_end",
        source: "openclaw-plugin",
      });
      return { session_id: this.sessionId, events_processed: 0 };
    }
  }

  // -----------------------------------------------------------------------
  // Insight submission
  // -----------------------------------------------------------------------

  private async submitInsights(content: unknown): Promise<unknown> {
    if (this.isLocal) {
      return this.mcpCall<unknown>("awareness_record", {
        action: "submit_insights",
        insights: content,
        session_id: this.sessionId,
      });
    }

    const body: Record<string, unknown> = {
      memory_id: this.memoryId,
      session_id: this.sessionId,
      insights: content,
    };
    if (this.agentRole) body.agent_role = this.agentRole;
    return this.post<unknown>(
      `/memories/${this.memoryId}/insights/submit`,
      body,
    );
  }

  // -----------------------------------------------------------------------
  // Backfill conversation history
  // -----------------------------------------------------------------------

  private async backfillConversation(
    history: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<IngestResponse> {
    if (this.isLocal) {
      // For local, batch-record each message as a memory
      const messages = Array.isArray(history) ? history : [];
      const steps = messages
        .filter((m: unknown) => m && typeof m === "object")
        .map((m: unknown) => {
          const msg = m as Record<string, unknown>;
          return `[${msg.role ?? "unknown"}] ${String(msg.content ?? "").slice(0, 500)}`;
        });
      if (steps.length === 0) return { status: "ok", written: 0 };
      return this.rememberBatch(steps);
    }

    const body: Record<string, unknown> = {
      memory_id: this.memoryId,
      session_id: this.sessionId,
      history,
      source: "openclaw-plugin",
      generate_summary: true,
      max_events: 800,
    };
    if (this.agentRole) body.agent_role = this.agentRole;
    if (metadata) body.metadata_defaults = metadata;
    return this.post<IngestResponse>("/mcp/events/backfill", body);
  }

  // -----------------------------------------------------------------------
  // Knowledge card management
  // -----------------------------------------------------------------------

  async supersedeCard(cardId: string): Promise<SupersedeResponse> {
    if (this.isLocal) {
      // Local daemon doesn't have a supersede endpoint; no-op
      return { id: cardId, status: "superseded" };
    }
    return this.patch<SupersedeResponse>(
      `/memories/${this.memoryId}/insights/knowledge-cards/${cardId}/supersede`,
      {},
    );
  }

  // -----------------------------------------------------------------------
  // Internal HTTP helpers (used for cloud mode only)
  // -----------------------------------------------------------------------

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      h.Authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async get<T>(path: string, params?: URLSearchParams): Promise<T> {
    const qs = params && params.toString() ? `?${params.toString()}` : "";
    const url = `${this.baseUrl}${path}${qs}`;

    const response = await fetch(url, {
      method: "GET",
      headers: this.headers(),
    });

    if (!response.ok) {
      const detail = await this.extractErrorDetail(response);
      throw new Error(
        `Awareness API GET ${path} failed (${response.status}): ${detail}`,
      );
    }

    return (await response.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await this.extractErrorDetail(response);
      throw new Error(
        `Awareness API POST ${path} failed (${response.status}): ${detail}`,
      );
    }

    return (await response.json()) as T;
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await this.extractErrorDetail(response);
      throw new Error(
        `Awareness API PATCH ${path} failed (${response.status}): ${detail}`,
      );
    }

    return (await response.json()) as T;
  }

  private async extractErrorDetail(response: Response): Promise<string> {
    try {
      const text = await response.text();
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        return String(json.detail ?? json.message ?? json.error ?? text);
      } catch {
        return text || response.statusText;
      }
    } catch {
      return response.statusText;
    }
  }
}
