import { MemoryCloudError } from "./errors";
import { readPositiveIntEnv } from "./env";
import {
  AgentListResponse,
  DetectRoleResult,
  ExportPackageResponse,
  HandoffContextResponse,
  HandoffKnowledge,
  HandoffTask,
  IngestEventsResponse,
  JsonObject,
  KnowledgeBaseResponse,
  KnowledgeCard,
  MemoryCloudClientConfig,
  MemoryUsersResult,
  OpenTask,
  PendingTasksResponse,
  RetrieveResponse,
  SessionContextResponse,
  UpdateTaskResult,
  WriteResponse,
} from "./types";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class MemoryCloudClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly sessionPrefix: string;
  private readonly defaultSource: string;
  private readonly sessionCache = new Map<string, string>();

  // Auto-extraction config
  private readonly enableExtraction: boolean;
  private readonly extractionLlm: any;
  private readonly extractionModel?: string;
  private readonly extractionMaxTokens: number;
  private readonly userId?: string;
  private readonly agentRole?: string;
  private readonly llmType?: "openai" | "anthropic";

  constructor(config: MemoryCloudClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.maxRetries = Math.max(0, config.maxRetries ?? 2);
    this.backoffMs = Math.max(0, config.backoffMs ?? 500);
    this.sessionPrefix = config.sessionPrefix ?? "sdk";
    this.defaultSource = config.defaultSource ?? "sdk";

    this.extractionLlm = config.extractionLlm;
    this.enableExtraction = config.extractionLlm != null;
    this.extractionModel = config.extractionModel;
    const envMax = readPositiveIntEnv("AWARENESS_EXTRACTION_MAX_TOKENS");
    this.extractionMaxTokens = config.extractionMaxTokens ?? envMax ?? 16384;
    this.userId = config.userId;
    this.agentRole = config.agentRole;

    if (this.extractionLlm) {
      this.llmType = detectLlmType(this.extractionLlm);
    }
  }

  // ----------------------------
  // Memory CRUD
  // ----------------------------
  async createMemory(input: { payload: JsonObject; traceId?: string }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "POST",
      path: "/memories",
      jsonBody: input.payload,
      traceId: input.traceId,
    });
  }

  async listMemories(input?: {
    ownerId?: string;
    skip?: number;
    limit?: number;
    traceId?: string;
  }): Promise<JsonObject[]> {
    const query = new URLSearchParams();
    query.set("skip", String(Math.max(0, input?.skip ?? 0)));
    query.set("limit", String(Math.max(1, input?.limit ?? 100)));
    if (input?.ownerId) query.set("owner_id", input.ownerId);

    const payload = await this.requestJson<unknown>({
      method: "GET",
      path: `/memories?${query.toString()}`,
      traceId: input?.traceId,
    });
    return Array.isArray(payload) ? payload.filter((item): item is JsonObject => isRecord(item)) : [];
  }

  async getMemory(input: { memoryId: string; traceId?: string }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "GET",
      path: `/memories/${input.memoryId}`,
      traceId: input.traceId,
    });
  }

  async updateMemory(input: {
    memoryId: string;
    payload: JsonObject;
    traceId?: string;
  }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "PATCH",
      path: `/memories/${input.memoryId}`,
      jsonBody: input.payload,
      traceId: input.traceId,
    });
  }

  async deleteMemory(input: { memoryId: string; traceId?: string }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "DELETE",
      path: `/memories/${input.memoryId}`,
      traceId: input.traceId,
    });
  }

  // ----------------------------
  // Content / Timeline / Chat
  // ----------------------------
  async listMemoryContent(input: {
    memoryId: string;
    limit?: number;
    offset?: number;
    traceId?: string;
  }): Promise<JsonObject[]> {
    const query = new URLSearchParams({
      limit: String(Math.max(1, input.limit ?? 100)),
      offset: String(Math.max(0, input.offset ?? 0)),
    });
    const payload = await this.requestJson<unknown>({
      method: "GET",
      path: `/memories/${input.memoryId}/content?${query.toString()}`,
      traceId: input.traceId,
    });
    return Array.isArray(payload) ? payload.filter((item): item is JsonObject => isRecord(item)) : [];
  }

  /**
   * Retrieve from memory using the specified recall mode.
   *
   * Default: "precise" for low-level SDK calls. Higher-level helpers keep
   * using "hybrid" by default for more reliable continuation recall.
   *
   * recallMode options:
   * - "precise": chunk reconstruction only (fast, targeted)
   * - "session": expand matched anchors to complete session histories
   * - "structured": zero-LLM DB-only — returns cards + narratives + tasks (~1-2k tokens)
   * - "hybrid": structured data + top-K vector results (~2-4k tokens)
   * - "auto": detect from query intent
   */
  async retrieve(input: {
    memoryId: string;
    query: string;
    limit?: number;
    useHybridSearch?: boolean;
    useMmr?: boolean;
    mmrLambda?: number;
    reconstructChunks?: boolean;
    maxStitchedChars?: number;
    recallMode?: "precise" | "session" | "structured" | "hybrid" | "auto";
    maxSessions?: number;
    maxSessionChars?: number;
    customKwargs?: JsonObject;
    metadataFilter?: JsonObject;
    permissionFilter?: "private" | "public" | "paid";
    keywordQuery?: string;
    scope?: "all" | "timeline" | "knowledge" | "insights";
    confidenceThreshold?: number;
    includeRawChunks?: boolean;
    userId?: string;
    agentRole?: string;
    multiLevel?: boolean;
    clusterExpand?: boolean;
    includeInstalled?: boolean;
    traceId?: string;
  }): Promise<RetrieveResponse> {
    const merged: JsonObject = {
      limit: input.limit ?? 12,
      reconstruct_chunks: input.reconstructChunks ?? true,
      max_stitched_chars: input.maxStitchedChars ?? 4000,
      recall_mode: input.recallMode ?? "precise",
      max_sessions: input.maxSessions ?? 5,
      max_session_chars: input.maxSessionChars ?? 8000,
    };
    if (input.useHybridSearch !== undefined) {
      merged["use_hybrid_search"] = input.useHybridSearch;
    }
    if (input.useMmr) {
      merged["use_mmr"] = true;
      merged["mmr_lambda"] = input.mmrLambda ?? 0.5;
    }
    Object.assign(merged, input.customKwargs ?? {});

    // Scope-based metadata filtering
    const resolvedFilter: JsonObject = { ...(input.metadataFilter ?? {}) };
    if (input.scope && input.scope !== "all") {
      const scopeMap: Record<string, string[]> = {
        timeline: ["timeline"],
        knowledge: ["knowledge", "full_source"],
        insights: ["insight_summary"],
      };
      if (scopeMap[input.scope]) {
        resolvedFilter["aw_content_scope"] = scopeMap[input.scope];
      }
    }

    // Auto-extract keywords for full-text search if not provided (same as MCP server behavior)
    const effectiveKeyword = input.keywordQuery || extractKeywords(input.query);
    if (effectiveKeyword) {
      merged["keyword_query"] = effectiveKeyword;
    }

    const body: JsonObject = {
      query: input.query,
      keyword_query: effectiveKeyword || null,
      custom_kwargs: merged,
      metadata_filter: Object.keys(resolvedFilter).length > 0 ? resolvedFilter : null,
      permission_filter: input.permissionFilter ?? "private",
      recall_mode: input.recallMode ?? "precise",
    };
    if (input.confidenceThreshold !== undefined) {
      body["confidence_threshold"] = input.confidenceThreshold;
    }
    if (input.includeRawChunks) {
      body["include_raw_chunks"] = true;
    }
    if (input.userId) body["user_id"] = input.userId;
    if (input.agentRole) body["agent_role"] = input.agentRole;
    if (input.multiLevel) body["multi_level"] = true;
    if (input.clusterExpand) body["cluster_expand"] = true;
    if (input.includeInstalled) body["include_installed"] = true;

    return this.requestJson<RetrieveResponse>({
      method: "POST",
      path: `/memories/${input.memoryId}/retrieve`,
      jsonBody: body,
      traceId: input.traceId,
    });
  }

  async write(input: {
    memoryId: string;
    content: unknown;
    kwargs?: JsonObject;
    asyncVectorize?: boolean;
    idempotencyKey?: string;
    traceId?: string;
  }): Promise<WriteResponse> {
    const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
    return this.requestJson<WriteResponse>({
      method: "POST",
      path: `/memories/${input.memoryId}/content`,
      jsonBody: {
        content: input.content,
        kwargs: input.kwargs ?? {},
        async_vectorize: input.asyncVectorize ?? true,
      },
      traceId: input.traceId,
      idempotencyKey,
    });
  }

  async deleteMemoryContent(input: {
    memoryId: string;
    contentId: string;
    traceId?: string;
  }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "DELETE",
      path: `/memories/${input.memoryId}/content/${input.contentId}`,
      traceId: input.traceId,
    });
  }

  async memoryTimeline(input: {
    memoryId: string;
    limit?: number;
    offset?: number;
    sessionId?: string;
    includeSummaries?: boolean;
    traceId?: string;
  }): Promise<JsonObject> {
    const query = new URLSearchParams({
      limit: String(Math.max(1, input.limit ?? 200)),
      offset: String(Math.max(0, input.offset ?? 0)),
      include_summaries: String(input.includeSummaries ?? true),
    });
    if (input.sessionId?.trim()) query.set("session_id", input.sessionId.trim());

    return this.requestJson<JsonObject>({
      method: "GET",
      path: `/memories/${input.memoryId}/timeline?${query.toString()}`,
      traceId: input.traceId,
    });
  }

  async chat(input: {
    memoryId: string;
    query: string;
    model?: string;
    sessionId?: string;
    metadataFilter?: JsonObject;
    contextBudgetTokens?: number;
    traceId?: string;
  }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "POST",
      path: `/memories/${input.memoryId}/chat`,
      jsonBody: {
        query: input.query,
        stream: false,
        model: input.model ?? null,
        session_id: input.sessionId ?? null,
        metadata_filter: input.metadataFilter ?? null,
        context_budget_tokens: input.contextBudgetTokens ?? null,
      },
      traceId: input.traceId,
    });
  }

  async chatStream(input: {
    memoryId: string;
    query: string;
    model?: string;
    sessionId?: string;
    metadataFilter?: JsonObject;
    contextBudgetTokens?: number;
    traceId?: string;
    onEvent: (event: JsonObject) => void;
  }): Promise<void> {
    const res = await this.requestRaw({
      method: "POST",
      path: `/memories/${input.memoryId}/chat`,
      jsonBody: {
        query: input.query,
        stream: true,
        model: input.model ?? null,
        session_id: input.sessionId ?? null,
        metadata_filter: input.metadataFilter ?? null,
        context_budget_tokens: input.contextBudgetTokens ?? null,
      },
      traceId: input.traceId,
    });

    if (!res.response.body) return;

    const reader = res.response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          if (isRecord(parsed)) {
            const withTrace = this.attachTrace(parsed, res.traceId);
            input.onEvent(withTrace);
          }
        } catch {
          // Ignore malformed stream line.
        }
      }
    }
  }

  // ----------------------------
  // Ingest / MCP-style helpers
  // ----------------------------
  async ingestEvents(input: {
    memoryId: string;
    events: JsonObject[];
    defaultSource?: string;
    metadataDefaults?: JsonObject;
    skipDuplicates?: boolean;
    generateSummary?: boolean;
    summaryMinNewEvents?: number;
    useLatentSummary?: boolean;
    summaryInstruction?: string;
    asyncVectorize?: boolean;
    agentRole?: string;
    userId?: string;
    insights?: JsonObject;
    traceId?: string;
  }): Promise<IngestEventsResponse> {
    const body: JsonObject = {
      memory_id: input.memoryId,
      events: input.events,
      default_source: input.defaultSource ?? "mcp",
      metadata_defaults: input.metadataDefaults ?? {},
      skip_duplicates: input.skipDuplicates ?? true,
      generate_summary: input.generateSummary ?? true,
      summary_min_new_events: input.summaryMinNewEvents ?? 6,
      use_latent_summary: input.useLatentSummary ?? true,
      summary_instruction: input.summaryInstruction ?? null,
      async_vectorize: input.asyncVectorize ?? true,
      agent_role: input.agentRole ?? null,
    };
    if (input.userId) body.user_id = input.userId;
    if (input.insights) body.insights = input.insights;
    return this.requestJson<IngestEventsResponse>({
      method: "POST",
      path: "/mcp/events",
      jsonBody: body,
      traceId: input.traceId,
    });
  }

  async ingestContent(input: {
    memoryId: string;
    content: unknown;
    agentRole?: string;
    source?: string;
    metadataDefaults?: JsonObject;
    asyncVectorize?: boolean;
    traceId?: string;
  }): Promise<IngestEventsResponse> {
    return this.requestJson<IngestEventsResponse>({
      method: "POST",
      path: "/mcp/events",
      jsonBody: {
        memory_id: input.memoryId,
        content: input.content,
        agent_role: input.agentRole ?? null,
        default_source: input.source ?? null,
        metadata_defaults: input.metadataDefaults ?? {},
        async_vectorize: input.asyncVectorize ?? true,
      },
      traceId: input.traceId,
    });
  }

  beginMemorySession(input: { memoryId: string; source?: string; sessionId?: string }): JsonObject {
    const sourceLabel = this.cleanSource(input.source ?? this.defaultSource);
    const activeSession = this.resolveSession({
      memoryId: input.memoryId,
      source: sourceLabel,
      sessionId: input.sessionId,
      rotate: !input.sessionId,
    });
    return {
      memory_id: input.memoryId,
      source: sourceLabel,
      session_id: activeSession,
    };
  }

  /**
   * Recall relevant context for a task.
   *
   * recallMode options:
   * - "precise": chunk reconstruction only
   * - "session": expand to complete session histories
   * - "structured": zero-LLM DB-only (~1-2k tokens)
   * - "hybrid" (default): structured + top-K vector results (~2-4k tokens)
   * - "auto": detect from query intent
   */
  async recallForTask(input: {
    memoryId: string;
    task: string;
    limit?: number;
    source?: string;
    sessionId?: string;
    useHybridSearch?: boolean;
    useMmr?: boolean;
    mmrLambda?: number;
    reconstructChunks?: boolean;
    maxStitchedChars?: number;
    recallMode?: "precise" | "session" | "structured" | "hybrid" | "auto";
    maxSessions?: number;
    maxSessionChars?: number;
    metadataFilter?: JsonObject;
    keywordQuery?: string;
    scope?: "all" | "timeline" | "knowledge" | "insights";
    confidenceThreshold?: number;
    includeRawChunks?: boolean;
    userId?: string;
    agentRole?: string;
    multiLevel?: boolean;
    clusterExpand?: boolean;
    includeInstalled?: boolean;
    traceId?: string;
  }): Promise<JsonObject> {
    const sourceLabel = this.cleanSource(input.source ?? this.defaultSource);
    const activeSession = this.resolveSession({
      memoryId: input.memoryId,
      source: sourceLabel,
      sessionId: input.sessionId,
      rotate: false,
    });

    const query =
      `${input.task}\n` +
      "Return architecture decisions, changed files, completed work, remaining todos, and blockers.";

    const retrieved = await this.retrieve({
      memoryId: input.memoryId,
      query,
      limit: Math.max(1, Math.min(input.limit ?? 12, 30)),
      useHybridSearch: input.useHybridSearch ?? true,
      useMmr: input.useMmr ?? false,
      mmrLambda: input.mmrLambda,
      reconstructChunks: input.reconstructChunks ?? true,
      maxStitchedChars: input.maxStitchedChars,
      recallMode: input.recallMode ?? "hybrid",
      maxSessions: input.maxSessions,
      maxSessionChars: input.maxSessionChars,
      metadataFilter: input.metadataFilter,
      keywordQuery: input.keywordQuery,
      scope: input.scope,
      confidenceThreshold: input.confidenceThreshold,
      includeRawChunks: input.includeRawChunks,
      userId: input.userId,
      agentRole: input.agentRole,
      multiLevel: input.multiLevel,
      clusterExpand: input.clusterExpand,
      includeInstalled: input.includeInstalled,
      traceId: input.traceId,
    });

    return {
      memory_id: input.memoryId,
      source: sourceLabel,
      session_id: activeSession,
      results: Array.isArray(retrieved.results) ? retrieved.results : [],
      trace_id: retrieved.trace_id,
    };
  }

  async rememberStep(input: {
    memoryId: string;
    text: string;
    source?: string;
    sessionId?: string;
    actor?: string;
    eventType?: string;
    metadata?: JsonObject;
    metadataDefaults?: JsonObject;
    userId?: string;
    insights?: JsonObject;
    traceId?: string;
  }): Promise<JsonObject> {
    const sourceLabel = this.cleanSource(input.source ?? this.defaultSource);
    const activeSession = this.resolveSession({
      memoryId: input.memoryId,
      source: sourceLabel,
      sessionId: input.sessionId,
      rotate: false,
    });

    const body = (input.text ?? "").trim();
    if (!body) {
      throw new MemoryCloudError("INVALID_ARGUMENT", "text is required");
    }

    const event: JsonObject = {
      content: body,
      source: sourceLabel,
      session_id: activeSession,
      actor: this.inferActor(body, input.actor),
      event_type: this.inferEventType(body, input.eventType),
      timestamp: this.nowIso(),
    };
    if (input.metadata) {
      event.metadata = input.metadata;
    }

    const result = await this.ingestEvents({
      memoryId: input.memoryId,
      events: [event],
      defaultSource: sourceLabel,
      metadataDefaults: input.metadataDefaults,
      skipDuplicates: true,
      generateSummary: false,
      userId: input.userId,
      insights: input.insights,
      traceId: input.traceId,
    });

    const response: JsonObject = {
      memory_id: input.memoryId,
      source: sourceLabel,
      session_id: activeSession,
      event,
      result,
      extraction_request:
        result && typeof result === "object" && "extraction_request" in result
          ? (result as any).extraction_request
          : undefined,
      trace_id: result.trace_id,
    };
    this.maybeAutoExtract(response, input.memoryId);
    return response;
  }

  async rememberBatch(input: {
    memoryId: string;
    steps: Array<string | JsonObject>;
    source?: string;
    sessionId?: string;
    metadataDefaults?: JsonObject;
    userId?: string;
    insights?: JsonObject;
    traceId?: string;
  }): Promise<JsonObject> {
    const sourceLabel = this.cleanSource(input.source ?? this.defaultSource);
    const activeSession = this.resolveSession({
      memoryId: input.memoryId,
      source: sourceLabel,
      sessionId: input.sessionId,
      rotate: false,
    });

    const events: JsonObject[] = [];
    for (const step of input.steps) {
      const normalized = this.normalizeStep(step, sourceLabel, activeSession);
      if (normalized) {
        events.push(normalized);
      }
    }
    if (events.length === 0) {
      throw new MemoryCloudError("INVALID_ARGUMENT", "no valid steps provided");
    }

    const result = await this.ingestEvents({
      memoryId: input.memoryId,
      events,
      defaultSource: sourceLabel,
      metadataDefaults: input.metadataDefaults,
      skipDuplicates: true,
      generateSummary: true,
      userId: input.userId,
      insights: input.insights,
      traceId: input.traceId,
    });

    const response: JsonObject = {
      memory_id: input.memoryId,
      source: sourceLabel,
      session_id: activeSession,
      accepted_steps: events.length,
      result,
      extraction_request:
        result && typeof result === "object" && "extraction_request" in result
          ? (result as any).extraction_request
          : undefined,
      trace_id: result.trace_id,
    };
    this.maybeAutoExtract(response, input.memoryId);
    return response;
  }

  /**
   * Submit pre-extracted insights from client-side LLM processing (no server-side LLM needed).
   *
   * Called after processing an extraction_request returned from rememberStep/rememberBatch.
   * The server stores insights with server-side deduplication (zero LLM calls).
   */
  async submitInsights(input: {
    memoryId: string;
    insights: JsonObject;
    sessionId?: string;
    userId?: string;
    agentRole?: string;
    traceId?: string;
  }): Promise<JsonObject> {
    const payload: JsonObject = { ...input.insights };
    if (input.sessionId) payload.session_id = input.sessionId;
    if (input.userId) payload.user_id = input.userId;
    if (input.agentRole) payload.agent_role = input.agentRole;

    return this.requestJson<JsonObject>({
      method: "POST",
      path: `/memories/${input.memoryId}/insights/submit`,
      jsonBody: payload,
      traceId: input.traceId,
    });
  }

  async backfillConversationHistory(input: {
    memoryId: string;
    history: string | string[] | JsonObject | JsonObject[];
    source?: string;
    sessionId?: string;
    agentRole?: string;
    metadataDefaults?: JsonObject;
    generateSummary?: boolean;
    summaryMinNewEvents?: number;
    maxEvents?: number;
    traceId?: string;
  }): Promise<JsonObject> {
    const sourceLabel = this.cleanSource(input.source ?? this.defaultSource);
    const activeSession = this.resolveSession({
      memoryId: input.memoryId,
      source: sourceLabel,
      sessionId: input.sessionId,
      rotate: false,
    });

    const events = this.coerceHistoryToEvents(input.history, sourceLabel, activeSession);
    if (events.length === 0) {
      throw new MemoryCloudError("INVALID_ARGUMENT", "no parseable history found");
    }

    const maxEvents = Math.max(1, Math.min(input.maxEvents ?? 800, 5000));
    const cappedEvents = events.slice(0, maxEvents);
    const metadataDefaults: JsonObject = { ...(input.metadataDefaults ?? {}) };
    if ((input.agentRole ?? "").trim() && metadataDefaults.agent_role === undefined) {
      metadataDefaults.agent_role = input.agentRole?.trim();
    }

    const result = await this.ingestEvents({
      memoryId: input.memoryId,
      events: cappedEvents,
      defaultSource: sourceLabel,
      metadataDefaults,
      skipDuplicates: true,
      generateSummary: input.generateSummary ?? true,
      summaryMinNewEvents: Math.max(1, input.summaryMinNewEvents ?? 10),
      traceId: input.traceId,
    });

    return {
      memory_id: input.memoryId,
      source: sourceLabel,
      session_id: activeSession,
      parsed_events: events.length,
      ingested_events: cappedEvents.length,
      truncated: cappedEvents.length < events.length,
      result,
      trace_id: result.trace_id,
    };
  }

  // ----------------------------
  // Context / Knowledge / Tasks
  // ----------------------------

  // ------------------------------------------------------------------
  // LLM-based reranking (client-side, uses user's LLM)
  // ------------------------------------------------------------------

  /**
   * Rerank retrieval results using the user's LLM as a cross-encoder.
   *
   * Client-side only — sends query + candidate snippets to the configured
   * extraction LLM and asks it to rank by relevance. No server-side LLM calls.
   *
   * @returns A reordered subset of results (length ≤ topK) with `_rerank_position`.
   */
  async rerank(input: {
    query: string;
    results: JsonObject[];
    topK?: number;
    maxContentChars?: number;
  }): Promise<JsonObject[]> {
    const { query, results } = input;
    const topK = input.topK ?? 5;
    const maxContentChars = input.maxContentChars ?? 200;

    if (!results.length || topK <= 0) return results.slice(0, topK);
    if (!this.extractionLlm) {
      console.debug("[awareness] rerank: no extractionLlm configured, returning original order");
      return results.slice(0, topK);
    }

    // Cap candidates to avoid token explosion
    const candidates = results.slice(0, 20);
    const numbered = candidates
      .map((item, i) => {
        const snippet = String(item.content ?? "").trim().slice(0, maxContentChars);
        return snippet ? `${i}. ${snippet}` : null;
      })
      .filter(Boolean);

    if (!numbered.length) return results.slice(0, topK);

    const systemPrompt =
      "You are a relevance ranker. Given a query and numbered candidate texts, " +
      "return ONLY a JSON array of candidate indices ordered by relevance to the query " +
      `(most relevant first). Return the indices as integers. Example: [3, 0, 7, 1]\n` +
      "Rules:\n" +
      "- Return ONLY the JSON array, nothing else.\n" +
      `- Include at most ${topK} indices.\n` +
      "- Judge relevance by semantic meaning, not surface keyword overlap.";

    const userContent = `Query: ${query}\n\nCandidates:\n${numbered.join("\n")}`;

    try {
      let raw = await this.callExtractionLlm(systemPrompt, userContent);
      if (!raw) return results.slice(0, topK);

      raw = raw.trim();
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
      }

      const indices: unknown = JSON.parse(raw);
      if (!Array.isArray(indices)) {
        console.warn("[awareness] rerank: LLM did not return an array, using original order");
        return results.slice(0, topK);
      }

      const seen = new Set<number>();
      const reranked: JsonObject[] = [];
      for (const idx of indices) {
        const n = Number(idx);
        if (Number.isInteger(n) && n >= 0 && n < candidates.length && !seen.has(n)) {
          seen.add(n);
          reranked.push({ ...candidates[n], _rerank_position: n });
          if (reranked.length >= topK) break;
        }
      }

      return reranked.length > 0 ? reranked : results.slice(0, topK);
    } catch (err: any) {
      console.warn("[awareness] rerank: LLM reranking failed, using original order:", err?.message ?? err);
      return results.slice(0, topK);
    }
  }

  /**
   * Fetch the complete, chronological event log for a specific session.
   *
   * Unlike retrieve() (vector search), this returns ALL events in chronological order
   * — no scoring, no relevance filtering. Use when you have a session_id from
   * recallForTask results and want the full conversation/activity history.
   */
  async getSessionHistory(input: {
    memoryId: string;
    sessionId: string;
    limit?: number;
    userId?: string;
    traceId?: string;
  }): Promise<{ memory_id: string; session_id: string; event_count: number; events: JsonObject[] }> {
    const params = new URLSearchParams({
      session_id: input.sessionId,
      limit: String(Math.max(1, Math.min(input.limit ?? 100, 500))),
    });
    if (input.userId) params.set("user_id", input.userId);
    const raw = await this.requestJson<unknown>({
      method: "GET",
      path: `/memories/${input.memoryId}/content?${params.toString()}`,
      traceId: input.traceId,
    });
    const arr = Array.isArray(raw) ? raw : (raw as JsonObject)?.["items"] ?? (raw as JsonObject)?.["results"] ?? [];
    const items = (arr as JsonObject[]).sort((a, b) => {
      const ts = (item: JsonObject) => {
        for (const k of ["aw_time_iso", "event_timestamp", "created_at"]) {
          const v = item[k];
          if (v) return String(v);
        }
        return "";
      };
      return ts(a).localeCompare(ts(b));
    });
    return {
      memory_id: input.memoryId,
      session_id: input.sessionId,
      event_count: items.length,
      events: items,
    };
  }

  /**
   * Load full structured project context at session start.
   * Returns recent daily narratives + open tasks + top knowledge cards.
   * Call at the BEGINNING of every session before doing any work.
   */
  async getSessionContext(input: {
    memoryId: string;
    days?: number;
    maxCards?: number;
    maxTasks?: number;
    userId?: string;
    traceId?: string;
  }): Promise<SessionContextResponse> {
    const query = new URLSearchParams({
      days: String(Math.max(1, input.days ?? 7)),
      max_cards: String(Math.max(1, input.maxCards ?? 10)),
      max_tasks: String(Math.max(1, input.maxTasks ?? 20)),
    });
    if (input.userId) query.set("user_id", input.userId);
    return this.requestJson<SessionContextResponse>({
      method: "GET",
      path: `/memories/${input.memoryId}/context?${query.toString()}`,
      traceId: input.traceId,
    });
  }

  /**
   * Query structured knowledge cards (decisions, solutions, workflows, pitfalls).
   * category: Engineering: problem_solution | decision | workflow | key_point | pitfall | insight
   *           Personal: personal_preference | important_detail | plan_intention | activity_preference | health_info | career_info | custom_misc
   * status: open | in_progress | resolved | noted
   */
  async getKnowledgeBase(input: {
    memoryId: string;
    query?: string;
    category?: string;
    status?: string;
    limit?: number;
    userId?: string;
    traceId?: string;
  }): Promise<KnowledgeBaseResponse> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, input.limit ?? 20)),
    });
    if (input.category) params.set("category", input.category);
    if (input.status) params.set("status", input.status);
    if (input.userId) params.set("user_id", input.userId);

    const resp = await this.requestJson<{ cards?: KnowledgeCard[]; total?: number }>({
      method: "GET",
      path: `/memories/${input.memoryId}/insights/knowledge-cards?${params.toString()}`,
      traceId: input.traceId,
    });

    let cards = Array.isArray(resp.cards) ? resp.cards : [];
    if (input.query) {
      const q = input.query.toLowerCase();
      cards = cards.filter(
        (c) =>
          (c.title ?? "").toLowerCase().includes(q) ||
          (c.summary ?? "").toLowerCase().includes(q)
      );
    }
    return { total: cards.length, cards };
  }

  /**
   * Get open and in-progress action items for task pickup.
   * priority: high | medium | low (empty = all)
   */
  async getPendingTasks(input: {
    memoryId: string;
    priority?: string;
    limit?: number;
    userId?: string;
    traceId?: string;
  }): Promise<PendingTasksResponse> {
    const limit = Math.max(1, input.limit ?? 30);
    const buildQuery = (status: string): string => {
      const p = new URLSearchParams({ limit: String(limit), status });
      if (input.priority) p.set("priority", input.priority);
      if (input.userId) p.set("user_id", input.userId);
      return p.toString();
    };

    const [pendingResp, inProgressResp] = await Promise.all([
      this.requestJson<{ action_items?: OpenTask[] }>({
        method: "GET",
        path: `/memories/${input.memoryId}/insights/action-items?${buildQuery("pending")}`,
        traceId: input.traceId,
      }),
      this.requestJson<{ action_items?: OpenTask[] }>({
        method: "GET",
        path: `/memories/${input.memoryId}/insights/action-items?${buildQuery("in_progress")}`,
        traceId: input.traceId,
      }),
    ]);

    const pending = Array.isArray(pendingResp.action_items) ? pendingResp.action_items : [];
    const inProgress = Array.isArray(inProgressResp.action_items) ? inProgressResp.action_items : [];
    const allTasks = [...inProgress, ...pending].slice(0, limit);

    return {
      total: allTasks.length,
      in_progress: inProgress.length,
      pending: pending.length,
      tasks: allTasks,
    };
  }

  /**
   * Get a compact structured briefing for resuming work in a new session or tool.
   * Use when switching tools (Cursor → Claude Code) or starting with zero context.
   */
  async getHandoffContext(input: {
    memoryId: string;
    currentTask?: string;
    traceId?: string;
  }): Promise<HandoffContextResponse> {
    const query = new URLSearchParams({ days: "3", max_cards: "5", max_tasks: "10" });
    const ctx = await this.requestJson<SessionContextResponse>({
      method: "GET",
      path: `/memories/${input.memoryId}/context?${query.toString()}`,
      traceId: input.traceId,
    });

    const recentProgress = (ctx.recent_days ?? [])
      .filter((d) => d.narrative)
      .map((d) => {
        const text = d.narrative ?? "";
        return `${d.date ?? ""}: ${text.length > 300 ? text.slice(0, 300) + "..." : text}`;
      });

    const openTasks: HandoffTask[] = (ctx.open_tasks ?? []).map((t) => ({
      title: t.title,
      priority: t.priority,
      status: t.status,
    }));

    const keyKnowledge: HandoffKnowledge[] = (ctx.knowledge_cards ?? []).map((c) => ({
      title: c.title,
      summary: (c.summary ?? "").slice(0, 200),
    }));

    const rawStr =
      JSON.stringify(recentProgress) +
      JSON.stringify(openTasks) +
      JSON.stringify(keyKnowledge);

    return {
      memory_id: input.memoryId,
      briefing_for: (input.currentTask ?? "").trim() || "Continue previous work",
      recent_progress: recentProgress,
      open_tasks: openTasks,
      key_knowledge: keyKnowledge,
      token_estimate: Math.max(100, Math.floor(rawStr.length / 4)),
      trace_id: ctx.trace_id,
    };
  }

  /**
   * Update an action item's status.
   *
   * Call after completing a task found via getPendingTasks or getSessionContext.
   * Always call rememberStep first to record what you did, then updateTaskStatus.
   *
   * status: "completed" | "in_progress" | "pending"
   * taskId: from getPendingTasks result tasks[i].id or getSessionContext open_tasks[i].id
   */
  async updateTaskStatus(input: {
    memoryId: string;
    taskId: string;
    status: "completed" | "in_progress" | "pending";
    traceId?: string;
  }): Promise<UpdateTaskResult> {
    return this.requestJson<UpdateTaskResult>({
      method: "PATCH",
      path: `/memories/${input.memoryId}/insights/action-items/${input.taskId}`,
      jsonBody: { status: input.status },
      traceId: input.traceId,
    });
  }

  /**
   * Auto-detect agent role from content using LLM.
   * When a memory has multiple agent_profiles configured, this endpoint
   * analyses the provided content and returns the most likely role.
   */
  async detectAgentRole(input: {
    memoryId: string;
    content: string;
    traceId?: string;
  }): Promise<DetectRoleResult> {
    return this.requestJson<DetectRoleResult>({
      method: "POST",
      path: `/memories/${input.memoryId}/detect-role`,
      jsonBody: { content: input.content },
      traceId: input.traceId,
    });
  }

  /**
   * List all agent profiles configured for this memory, with activation prompts.
   *
   * Returns enriched profiles that include auto-generated `system_prompt` and
   * `activation_prompt` fields. These can be used to spawn sub-agents
   * (e.g. via Claude Code's Agent tool).
   */
  async listAgents(input: {
    memoryId: string;
    traceId?: string;
  }): Promise<AgentListResponse> {
    return this.requestJson<AgentListResponse>({
      method: "GET",
      path: `/memories/${input.memoryId}/agents`,
      traceId: input.traceId,
    });
  }

  /**
   * Get the activation prompt for a specific agent role.
   *
   * Convenience wrapper around `listAgents` that returns the
   * `activation_prompt` for the given agent role, or null if not found.
   */
  async getAgentPrompt(input: {
    memoryId: string;
    agentRole: string;
    traceId?: string;
  }): Promise<string | null> {
    const data = await this.listAgents({
      memoryId: input.memoryId,
      traceId: input.traceId,
    });
    const agent = (data.agents ?? []).find(
      (a) => a.agent_role === input.agentRole,
    );
    return agent?.activation_prompt ?? agent?.system_prompt ?? null;
  }

  /**
   * List users who contributed to this memory.
   * Returns a paginated list of distinct user_id values.
   */
  async getMemoryUsers(input: {
    memoryId: string;
    limit?: number;
    offset?: number;
    traceId?: string;
  }): Promise<MemoryUsersResult> {
    const params = new URLSearchParams({
      limit: String(Math.max(1, input.limit ?? 50)),
      offset: String(Math.max(0, input.offset ?? 0)),
    });
    return this.requestJson<MemoryUsersResult>({
      method: "GET",
      path: `/memories/${input.memoryId}/users?${params.toString()}`,
      traceId: input.traceId,
    });
  }

  // ----------------------------
  // Insights / Jobs / Upload
  // ----------------------------
  async insights(input: {
    memoryId: string;
    query?: string;
    limit?: number;
    traceId?: string;
  }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "POST",
      path: "/insights/memory",
      jsonBody: {
        memory_id: input.memoryId,
        query: input.query ?? null,
        limit: input.limit ?? 120,
      },
      traceId: input.traceId,
    });
  }

  async getAsyncJobStatus(input: { jobId: string; traceId?: string }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "GET",
      path: `/jobs/${input.jobId}`,
      traceId: input.traceId,
    });
  }

  async uploadFile(input: {
    memoryId: string;
    file: Blob | Uint8Array;
    filename?: string;
    traceId?: string;
  }): Promise<JsonObject> {
    const formData = new FormData();
    if (input.file instanceof Blob) {
      formData.append("file", input.file, input.filename ?? "upload.bin");
    } else {
      const bytes = new Uint8Array(input.file.byteLength);
      bytes.set(input.file);
      formData.append("file", new Blob([bytes.buffer]), input.filename ?? "upload.bin");
    }

    return this.requestJson<JsonObject>({
      method: "POST",
      path: `/memories/${input.memoryId}/upload_file`,
      body: formData,
      traceId: input.traceId,
      includeJsonContentType: false,
    });
  }

  async getUploadJobStatus(input: {
    memoryId: string;
    uploadJobId: string;
    traceId?: string;
  }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "GET",
      path: `/memories/${input.memoryId}/upload_jobs/${input.uploadJobId}`,
      traceId: input.traceId,
    });
  }

  // ----------------------------
  // Export
  // ----------------------------
  async exportMemoryPackage(input: {
    memoryId: string;
    payload: JsonObject;
    traceId?: string;
  }): Promise<ExportPackageResponse> {
    const res = await this.requestRaw({
      method: "POST",
      path: `/memories/${input.memoryId}/export`,
      jsonBody: input.payload,
      traceId: input.traceId,
    });

    const contentDisposition = res.response.headers.get("Content-Disposition");
    const filename = this.extractFilename(
      contentDisposition,
      `memory_${input.memoryId}_${String(input.payload.package_type ?? "export")}.zip`
    );
    const contentType = res.response.headers.get("Content-Type") ?? "application/zip";
    const bytes = new Uint8Array(await res.response.arrayBuffer());

    return {
      filename,
      contentType,
      bytes,
      trace_id: res.traceId,
    };
  }

  async saveExportMemoryPackage(input: {
    memoryId: string;
    payload: JsonObject;
    traceId?: string;
  }): Promise<ExportPackageResponse> {
    return this.exportMemoryPackage(input);
  }

  // ----------------------------
  // API Keys / Wizard
  // ----------------------------
  async createApiKey(input: {
    ownerId: string;
    name?: string;
    traceId?: string;
  }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "POST",
      path: "/apikeys",
      jsonBody: {
        owner_id: input.ownerId,
        name: input.name ?? "Default Key",
      },
      traceId: input.traceId,
    });
  }

  async listApiKeys(input: { ownerId: string; traceId?: string }): Promise<JsonObject[]> {
    const query = new URLSearchParams({ owner_id: input.ownerId });
    const payload = await this.requestJson<unknown>({
      method: "GET",
      path: `/apikeys?${query.toString()}`,
      traceId: input.traceId,
    });
    return Array.isArray(payload) ? payload.filter((item): item is JsonObject => isRecord(item)) : [];
  }

  async revokeApiKey(input: {
    ownerId: string;
    keyId: string;
    traceId?: string;
  }): Promise<JsonObject> {
    const query = new URLSearchParams({ owner_id: input.ownerId });
    return this.requestJson<JsonObject>({
      method: "DELETE",
      path: `/apikeys/${input.keyId}?${query.toString()}`,
      traceId: input.traceId,
    });
  }

  async memoryWizard(input: {
    ownerId: string;
    messages: JsonObject[];
    draft?: JsonObject;
    locale?: string;
    traceId?: string;
  }): Promise<JsonObject> {
    return this.requestJson<JsonObject>({
      method: "POST",
      path: "/wizard/memory_designer",
      jsonBody: {
        owner_id: input.ownerId,
        messages: input.messages,
        draft: input.draft ?? {},
        locale: input.locale ?? "en",
      },
      traceId: input.traceId,
    });
  }

  private async requestJson<T>(input: {
    method: string;
    path: string;
    jsonBody?: unknown;
    body?: BodyInit;
    traceId?: string;
    idempotencyKey?: string;
    includeJsonContentType?: boolean;
    extraHeaders?: Record<string, string>;
  }): Promise<T> {
    const raw = await this.requestRaw(input);
    const payload = await this.parseJson(raw.response);

    if (isRecord(payload)) {
      const withTrace = this.attachTrace(payload, raw.traceId);
      return withTrace as unknown as T;
    }
    return payload as T;
  }

  private async requestRaw(input: {
    method: string;
    path: string;
    jsonBody?: unknown;
    body?: BodyInit;
    traceId?: string;
    idempotencyKey?: string;
    includeJsonContentType?: boolean;
    extraHeaders?: Record<string, string>;
  }): Promise<{ response: Response; traceId?: string }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const includeJsonContentType =
          input.includeJsonContentType ?? input.jsonBody !== undefined;

        const body =
          input.body !== undefined
            ? input.body
            : input.jsonBody !== undefined
              ? JSON.stringify(input.jsonBody)
              : undefined;

        const hdrs = this.headers({
            traceId: input.traceId,
            idempotencyKey: input.idempotencyKey,
            includeJsonContentType,
          });
        if (input.extraHeaders) {
          Object.assign(hdrs, input.extraHeaders);
        }

        const response = await fetch(`${this.baseUrl}${input.path}`, {
          method: input.method,
          headers: hdrs,
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const traceId =
          response.headers.get("X-Trace-Id") ??
          response.headers.get("X-Request-Id") ??
          input.traceId;

        if (!response.ok) {
          const payload = await this.parseJson(response);
          if (RETRYABLE.has(response.status) && attempt < this.maxRetries) {
            await this.sleep(this.backoffMs * 2 ** attempt);
            continue;
          }
          throw this.buildError(response.status, payload, traceId);
        }

        return { response, traceId };
      } catch (error) {
        lastError = error;
        if (error instanceof MemoryCloudError) {
          throw error;
        }
        if (attempt >= this.maxRetries) {
          throw new MemoryCloudError("NETWORK_ERROR", String(error));
        }
        await this.sleep(this.backoffMs * 2 ** attempt);
      }
    }

    throw new MemoryCloudError("INTERNAL", String(lastError ?? "Unknown request error"));
  }

  private headers(input: {
    traceId?: string;
    idempotencyKey?: string;
    includeJsonContentType: boolean;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (input.includeJsonContentType) {
      headers["Content-Type"] = "application/json";
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (input.traceId) {
      headers["X-Trace-Id"] = input.traceId;
    }
    if (input.idempotencyKey) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }
    return headers;
  }

  private async parseJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  private attachTrace(payload: JsonObject, traceId?: string): JsonObject {
    if (traceId && payload.trace_id === undefined) {
      return {
        ...payload,
        trace_id: traceId,
      };
    }
    return payload;
  }

  private buildError(status: number, payload: unknown, traceId?: string): MemoryCloudError {
    const fallbackCode = this.defaultCode(status);
    if (isRecord(payload)) {
      const nested = payload.error;
      if (nested && isRecord(nested)) {
        return new MemoryCloudError(
          String(nested.code ?? fallbackCode),
          String(nested.message ?? "Request failed"),
          { statusCode: status, traceId, payload }
        );
      }
      if (payload.detail) {
        return new MemoryCloudError(fallbackCode, String(payload.detail), {
          statusCode: status,
          traceId,
          payload,
        });
      }
    }
    return new MemoryCloudError(fallbackCode, String(payload), {
      statusCode: status,
      traceId,
      payload,
    });
  }

  private defaultCode(status: number): string {
    if (status === 400) return "INVALID_ARGUMENT";
    if (status === 401) return "UNAUTHENTICATED";
    if (status === 403) return "PERMISSION_DENIED";
    if (status === 404) return "NOT_FOUND";
    if (status === 409) return "CONFLICT";
    if (status === 429) return "RATE_LIMITED";
    if (status === 408) return "TIMEOUT";
    if (status >= 500) return "INTERNAL";
    return "UNKNOWN_ERROR";
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private cleanSource(source: string): string {
    const raw = (source || this.defaultSource).trim() || this.defaultSource;
    const cleaned = raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned || this.defaultSource;
  }

  private buildSessionId(memoryId: string, source: string): string {
    const shortMemory = (memoryId || "memory").slice(0, 8);
    const ts = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    return `${this.sessionPrefix}-${source}-${shortMemory}-${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
  }

  private resolveSession(input: {
    memoryId: string;
    source: string;
    sessionId?: string;
    rotate: boolean;
  }): string {
    const explicit = (input.sessionId ?? "").trim();
    if (explicit) {
      this.sessionCache.set(input.memoryId, explicit);
      return explicit;
    }

    const cached = this.sessionCache.get(input.memoryId);
    if (cached && !input.rotate) {
      return cached;
    }

    const generated = this.buildSessionId(input.memoryId, input.source);
    this.sessionCache.set(input.memoryId, generated);
    return generated;
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private inferActor(text: string, explicit?: string): string {
    if ((explicit ?? "").trim()) return String(explicit).trim();
    const lowered = text.trim().toLowerCase();
    if (lowered.startsWith("user:") || lowered.startsWith("human:")) return "user";
    if (lowered.startsWith("assistant:") || lowered.startsWith("ai:") || lowered.startsWith("model:")) return "assistant";
    return "assistant";
  }

  private inferEventType(text: string, explicit?: string): string {
    if ((explicit ?? "").trim()) return String(explicit).trim();
    const lowered = text.toLowerCase();
    if (["diff", "patch", "+++ ", "--- ", "@@ ", "file:", "refactor", "updated"].some((token) => lowered.includes(token))) {
      return "file_diff";
    }
    if (["tool", "command", "terminal", "exec ", "ran ", "playwright", "pytest", "test run"].some((token) => lowered.includes(token))) {
      return "tool_call";
    }
    if (["todo", "next:", "remaining", "blocker", "follow-up"].some((token) => lowered.includes(token))) {
      return "planning";
    }
    if (["error", "exception", "traceback", "failed", "bug"].some((token) => lowered.includes(token))) {
      return "issue";
    }
    return "message";
  }

  private normalizeStep(step: string | JsonObject, source: string, sessionId: string): JsonObject | null {
    if (typeof step === "string") {
      const text = step.trim();
      if (!text) return null;
      return {
        content: text,
        source,
        session_id: sessionId,
        actor: this.inferActor(text),
        event_type: this.inferEventType(text),
        timestamp: this.nowIso(),
      };
    }

    const event: JsonObject = { ...step };
    let text = "";
    for (const key of ["content", "text", "message", "body", "output", "input"]) {
      const value = event[key];
      if (value !== undefined && String(value).trim()) {
        text = String(value).trim();
        break;
      }
    }
    if (!text) return null;

    event.content = text;
    if (event.source === undefined) event.source = source;
    if (event.session_id === undefined) event.session_id = sessionId;
    if (event.actor === undefined) event.actor = this.inferActor(text);
    if (event.event_type === undefined) event.event_type = this.inferEventType(text);
    if (event.timestamp === undefined) event.timestamp = this.nowIso();
    return event;
  }

  private eventsFromTranscriptText(transcript: string, source: string, sessionId: string): JsonObject[] {
    const lines = transcript
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const output: JsonObject[] = [];
    for (const line of lines) {
      const normalized = this.normalizeStep(line, source, sessionId);
      if (normalized) output.push(normalized);
    }
    return output;
  }

  private coerceHistoryToEvents(
    history: string | string[] | JsonObject | JsonObject[],
    source: string,
    sessionId: string
  ): JsonObject[] {
    if (typeof history === "string") {
      const stripped = history.trim();
      if (!stripped) return [];

      if (stripped.startsWith("[") || stripped.startsWith("{")) {
        try {
          const parsed = JSON.parse(stripped) as string | string[] | JsonObject | JsonObject[];
          return this.coerceHistoryToEvents(parsed, source, sessionId);
        } catch {
          // Fall back to transcript parser.
        }
      }
      return this.eventsFromTranscriptText(stripped, source, sessionId);
    }

    if (Array.isArray(history)) {
      const events: JsonObject[] = [];
      for (const item of history) {
        if (typeof item === "string") {
          if (item.includes("\n")) {
            events.push(...this.eventsFromTranscriptText(item, source, sessionId));
          } else {
            const normalized = this.normalizeStep(item, source, sessionId);
            if (normalized) events.push(normalized);
          }
        } else if (isRecord(item)) {
          const normalized = this.normalizeStep(item, source, sessionId);
          if (normalized) events.push(normalized);
        }
      }
      return events;
    }

    if (isRecord(history)) {
      const events = history.events;
      if (Array.isArray(events)) {
        return this.coerceHistoryToEvents(events as string[] | JsonObject[], source, sessionId);
      }
      const messages = history.messages;
      if (Array.isArray(messages)) {
        return this.coerceHistoryToEvents(messages as string[] | JsonObject[], source, sessionId);
      }
      const normalized = this.normalizeStep(history, source, sessionId);
      return normalized ? [normalized] : [];
    }

    return [];
  }

  private extractFilename(contentDisposition: string | null, fallback: string): string {
    if (!contentDisposition) return fallback;

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1].replace(/["']/g, "").trim());
      } catch {
        return utf8Match[1].trim();
      }
    }

    const basicMatch = contentDisposition.match(/filename="?([^\";]+)"?/i);
    if (basicMatch?.[1]) return basicMatch[1].trim();
    return fallback;
  }

  // ------------------------------------------------------------------
  // Auto-extraction (fire-and-forget, non-blocking)
  // ------------------------------------------------------------------

  private maybeAutoExtract(result: JsonObject, memoryId: string): void {
    if (!this.enableExtraction || !this.extractionLlm) return;
    const extractionReq = result.extraction_request;
    if (!extractionReq || typeof extractionReq !== "object") return;
    const sessionId = (result.session_id as string) ?? "";
    // Fire-and-forget — do not await
    this.runExtraction(extractionReq as JsonObject, memoryId, sessionId).catch((err) => {
      console.warn("[awareness] auto-extraction failed:", err?.message ?? err);
    });
  }

  private async runExtraction(
    extractionReq: JsonObject,
    memoryId: string,
    sessionId: string,
  ): Promise<void> {
    const systemPrompt = (extractionReq.system_prompt as string) ?? "";
    const events = (extractionReq.events as JsonObject[]) ?? [];
    const existingCards = (extractionReq.existing_cards as JsonObject[]) ?? [];

    const cardsJson = existingCards.length > 0 ? JSON.stringify(existingCards, null, 2) : "[]";
    const filledPrompt = systemPrompt.replace("{existing_cards}", cardsJson);

    const compact = compactEvents(events);
    const userContent = JSON.stringify({ events: compact });

    let text = await this.callExtractionLlm(filledPrompt, userContent);
    if (!text) return;

    let insights: JsonObject;
    try {
      insights = parseInsightsJson(text);
    } catch {
      console.warn("[awareness] extraction JSON parse failed, retrying with stricter prompt");
      const retryPrompt =
        "Return one valid JSON object only. No markdown, no code fence, no extra commentary. " +
        "Required keys: knowledge_cards, risks, action_items.\n\n" +
        filledPrompt;
      const retryText = await this.callExtractionLlm(
        retryPrompt,
        JSON.stringify({ events: compact.slice(0, 8) }),
      );
      if (!retryText) return;
      insights = parseInsightsJson(retryText);
    }

    const turnBrief = insights.turn_brief;
    delete insights.turn_brief;
    insights = normalizeInsights(insights);

    await this.submitInsights({
      memoryId,
      insights,
      sessionId,
      userId: this.userId,
      agentRole: this.agentRole,
    });

    const cards = (insights.knowledge_cards as unknown[]) ?? [];
    const risks = (insights.risks as unknown[]) ?? [];
    const actions = (insights.action_items as unknown[]) ?? [];
    console.log(
      `[awareness] auto-extraction complete: ${cards.length} cards, ${risks.length} risks, ${actions.length} actions`,
    );

    if (turnBrief && typeof turnBrief === "string" && turnBrief.trim()) {
      try {
        await this.rememberStep({
          memoryId,
          text: turnBrief.trim(),
          sessionId,
          actor: "system",
          eventType: "turn_brief",
          userId: this.userId,
        });
      } catch (err: any) {
        console.warn("[awareness] turn brief storage failed:", err?.message ?? err);
      }
    }
  }

  private async callExtractionLlm(systemPrompt: string, userContent: string): Promise<string> {
    const llm = this.extractionLlm;
    if (this.llmType === "openai") {
      const model = this.extractionModel ?? "gpt-4o-mini";
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userContent },
      ];
      let response: any;
      try {
        response = await llm.chat.completions.create({
          model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: this.extractionMaxTokens,
        });
      } catch (exc: any) {
        if (!String(exc).toLowerCase().includes("response_format")) throw exc;
        response = await llm.chat.completions.create({
          model,
          messages: [
            { role: "system", content: "Return one valid JSON object only. No markdown, no code fence." },
            ...messages,
          ],
          temperature: 0,
          max_tokens: this.extractionMaxTokens,
        });
      }
      return response?.choices?.[0]?.message?.content ?? "";
    } else if (this.llmType === "anthropic") {
      const model = this.extractionModel ?? "claude-haiku-4-5-20251001";
      const response = await llm.messages.create({
        model,
        max_tokens: this.extractionMaxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
        temperature: 0,
      });
      const blocks = response?.content ?? [];
      return blocks
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text ?? "")
        .join(" ");
    }
    console.warn("[awareness] unknown LLM type for extraction");
    return "";
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function detectLlmType(llm: any): "openai" | "anthropic" | undefined {
  const name = llm?.constructor?.name ?? "";
  if (/openai/i.test(name)) return "openai";
  if (/anthropic/i.test(name)) return "anthropic";
  // Duck-type
  if (llm?.chat?.completions?.create) return "openai";
  if (llm?.messages?.create) return "anthropic";
  return undefined;
}

function coerceJsonText(text: string): string {
  let raw = (text ?? "").trim();
  if (!raw) return raw;
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  if (raw.startsWith("{") && raw.endsWith("}")) return raw;
  const start = raw.indexOf("{");
  if (start === -1) return raw;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; }
    else if (!inStr) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
  }
  return raw.slice(start);
}

function parseInsightsJson(text: string): JsonObject {
  const normalized = coerceJsonText(text);
  const parsed = JSON.parse(normalized);
  if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) {
    throw new Error("Extraction payload must be a JSON object");
  }
  return parsed as JsonObject;
}

const MIN_EVENT_CHARS = 8;

function compactEvents(
  events: JsonObject[],
  maxEvents = 12,
  maxCharsPerEvent = 480,
  maxTotalChars = 3600,
): string[] {
  const result: string[] = [];
  let total = 0;
  for (const event of events.slice(0, maxEvents)) {
    let text = String(event.content ?? "").trim();
    // Drop trivially short events (greetings, "ok", heartbeats, etc.)
    if (text.length < MIN_EVENT_CHARS) continue;
    text = text.slice(0, maxCharsPerEvent);
    if (total + text.length > maxTotalChars) break;
    result.push(text);
    total += text.length;
  }
  return result;
}

function normalizeInsights(insights: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const key of ["knowledge_cards", "risks", "action_items"]) {
    const val = insights[key];
    result[key] = Array.isArray(val) ? val : [];
  }
  return result;
}

/**
 * Language-agnostic structural keyword extraction for full-text search.
 * Mirrors MCP server's _extract_keywords_fallback and Python SDK's extract_keywords.
 */
function extractKeywords(text: string, maxKeywords = 8): string {
  if (!text) return "";
  const tokens: string[] = [];

  // Quoted content
  for (const m of text.matchAll(/[""\u201c]([^""\u201d]{2,40})[""\u201d]/g)) tokens.push(m[1]);
  for (const m of text.matchAll(/'([^']{2,40})'/g)) tokens.push(m[1]);

  // File patterns
  for (const m of text.matchAll(
    /[\w.-]+\.(?:py|js|ts|tsx|jsx|yml|yaml|json|md|csv|xlsx|pdf|sql|go|rs|java|rb|sh|env|toml|cfg|conf|xml|html|css|txt|log)\b/gi,
  ))
    tokens.push(m[0]);

  // UPPER-case (acronyms)
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]{1,15}\b/g)) tokens.push(m[0]);

  // camelCase / PascalCase
  for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) tokens.push(m[0]);

  // snake_case / kebab-case
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/g)) tokens.push(m[0]);

  // Numbers with context
  for (const m of text.matchAll(/[#vV]?\d[\d.,:-]+\w*/g)) tokens.push(m[0]);
  for (const m of text.matchAll(/\b[A-Z]+\d+\b/g)) tokens.push(m[0]);

  // Dedupe
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tokens) {
    const trimmed = t.trim();
    if (!trimmed || trimmed.length < 2) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
    if (result.length >= maxKeywords) break;
  }
  return result.join(" ");
}
