"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwarenessClient = void 0;
const LEGACY_TEXT_WEIGHT_KEY = ["b", "m", "25", "Weight"].join("");
// ---------------------------------------------------------------------------
// AwarenessClient — thin HTTP wrapper around the Awareness REST API
// ---------------------------------------------------------------------------
class AwarenessClient {
    constructor(baseUrl, apiKey, memoryId, agentRole) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.apiKey = apiKey;
        this.memoryId = memoryId;
        this.agentRole = agentRole;
        this.sessionId = `openclaw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    // -----------------------------------------------------------------------
    // 1. awareness_init — session initialization + context loading
    // -----------------------------------------------------------------------
    async init(days, maxCards, maxTasks) {
        const ctx = await this.getSessionContext(days, maxCards, maxTasks);
        return {
            session_id: this.sessionId,
            context: ctx,
        };
    }
    // -----------------------------------------------------------------------
    // 2. awareness_recall — semantic search with separate keyword query
    // -----------------------------------------------------------------------
    async search(opts) {
        const query = opts.semanticQuery;
        const legacyTextWeight = opts[LEGACY_TEXT_WEIGHT_KEY];
        const customKwargs = {
            limit: Math.max(1, Math.min(opts.limit ?? 6, 30)),
            use_hybrid_search: true,
            reconstruct_chunks: true,
            recall_mode: opts.recallMode ?? "hybrid",
            vector_weight: opts.vectorWeight ?? 0.7,
            full_text_weight: opts.fullTextWeight ??
                (typeof legacyTextWeight === "number" ? legacyTextWeight : undefined) ??
                0.3,
        };
        if (opts.multiLevel !== undefined)
            customKwargs.multi_level = opts.multiLevel;
        if (opts.clusterExpand !== undefined)
            customKwargs.cluster_expand = opts.clusterExpand;
        const body = { query, custom_kwargs: customKwargs };
        if (opts.confidenceThreshold !== undefined)
            body.confidence_threshold = opts.confidenceThreshold;
        if (opts.includeInstalled !== undefined)
            body.include_installed = opts.includeInstalled;
        if (opts.keywordQuery) {
            body.keyword_query = opts.keywordQuery;
        }
        if (opts.scope && opts.scope !== "all") {
            const scopeMap = {
                timeline: ["timeline"],
                knowledge: ["knowledge", "full_source"],
                insights: ["insight_summary"],
            };
            customKwargs.metadata_filter = {
                aw_content_scope: scopeMap[opts.scope],
            };
        }
        const agentRole = this.agentRole;
        if (agentRole)
            body.agent_role = agentRole;
        if (opts.userId)
            body.user_id = opts.userId;
        return this.post(`/memories/${this.memoryId}/retrieve`, body);
    }
    // -----------------------------------------------------------------------
    // 3. awareness_lookup — structured data retrieval by type
    // -----------------------------------------------------------------------
    async getData(type, params = {}) {
        switch (type) {
            case "context":
                return this.getSessionContext(params.days !== undefined ? Number(params.days) : undefined, params.max_cards !== undefined ? Number(params.max_cards) : undefined, params.max_tasks !== undefined ? Number(params.max_tasks) : undefined);
            case "tasks":
                return this.getPendingTasks(params.status !== undefined ? String(params.status) : undefined, params.priority !== undefined ? String(params.priority) : undefined, params.include_completed === true, params.limit !== undefined ? Number(params.limit) : undefined);
            case "knowledge":
                return this.getKnowledgeBase(params.query !== undefined ? String(params.query) : undefined, params.category !== undefined ? String(params.category) : undefined, params.limit !== undefined ? Number(params.limit) : undefined);
            case "risks":
                return this.getRisks(params.level !== undefined ? String(params.level) : undefined, params.status !== undefined ? String(params.status) : undefined, params.limit !== undefined ? Number(params.limit) : undefined);
            case "session_history":
                if (!params.session_id) {
                    return { error: "session_id is required for type='session_history'." };
                }
                return this.getSessionHistory(String(params.session_id), params.limit !== undefined ? Number(params.limit) : undefined);
            case "timeline":
                return this.getTimeline(params.limit !== undefined ? Number(params.limit) : undefined, params.offset !== undefined ? Number(params.offset) : undefined, params.session_id !== undefined ? String(params.session_id) : undefined);
            case "handoff":
                return this.getHandoffContext(params.query !== undefined ? String(params.query) : undefined);
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
    async write(action, params = {}) {
        const userId = params.user_id !== undefined ? String(params.user_id) : undefined;
        switch (action) {
            case "remember":
                return this.rememberStep(String(params.text ?? ""), params.metadata, userId);
            case "remember_batch": {
                const steps = Array.isArray(params.steps)
                    ? params.steps.map((s) => String(s.text ?? s))
                    : [];
                return this.rememberBatch(steps, userId);
            }
            case "backfill":
                return this.backfillConversation(params.history ?? params.content ?? params.text ?? "", params.metadata);
            case "ingest":
                return this.ingestContent(params.content, params.content_scope ?? "timeline", params.metadata);
            case "update_task":
                return this.updateTask(String(params.task_id ?? ""), String(params.status ?? "completed"));
            case "submit_insights":
                return this.submitInsights(params.content);
            default:
                return { error: `Unknown action: ${action}` };
        }
    }
    // -----------------------------------------------------------------------
    // Internal — Context & Insights
    // -----------------------------------------------------------------------
    async getSessionContext(days, maxCards, maxTasks) {
        const params = new URLSearchParams();
        if (days !== undefined)
            params.set("days", String(days));
        if (maxCards !== undefined)
            params.set("max_cards", String(maxCards));
        if (maxTasks !== undefined)
            params.set("max_tasks", String(maxTasks));
        if (this.agentRole)
            params.set("agent_role", this.agentRole);
        return this.get(`/memories/${this.memoryId}/context`, params);
    }
    async getKnowledgeBase(query, category, limit) {
        const params = new URLSearchParams();
        if (query)
            params.set("query", query);
        if (category)
            params.set("category", category);
        if (limit !== undefined)
            params.set("limit", String(limit));
        if (this.agentRole)
            params.set("agent_role", this.agentRole);
        return this.get(`/memories/${this.memoryId}/insights/knowledge-cards`, params);
    }
    async getPendingTasks(status, priority, includeCompleted, limit) {
        const params = new URLSearchParams();
        if (status)
            params.set("status", status);
        if (priority)
            params.set("priority", priority);
        if (limit !== undefined)
            params.set("limit", String(limit));
        if (this.agentRole)
            params.set("agent_role", this.agentRole);
        // For compatibility: fetch in_progress + pending if no specific status
        return this.get(`/memories/${this.memoryId}/insights/action-items`, params);
    }
    async getRisks(level, status, limit) {
        const params = new URLSearchParams();
        if (level)
            params.set("level", level);
        if (status)
            params.set("status", status);
        if (limit !== undefined)
            params.set("limit", String(limit));
        if (this.agentRole)
            params.set("agent_role", this.agentRole);
        return this.get(`/memories/${this.memoryId}/insights/risks`, params);
    }
    async getSessionHistory(sessionId, limit) {
        const params = new URLSearchParams({
            session_id: sessionId,
            limit: String(Math.max(1, Math.min(limit ?? 100, 500))),
        });
        const raw = await this.get(`/memories/${this.memoryId}/content`, params);
        const arr = Array.isArray(raw)
            ? raw
            : (raw?.["items"] ?? []);
        const items = arr.sort((a, b) => {
            const ts = (item) => {
                for (const k of ["aw_time_iso", "event_timestamp", "created_at"]) {
                    const v = item[k];
                    if (v)
                        return String(v);
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
    async getTimeline(limit, offset, sessionId) {
        const params = new URLSearchParams();
        if (limit !== undefined)
            params.set("limit", String(limit));
        if (offset !== undefined)
            params.set("offset", String(offset));
        if (sessionId)
            params.set("session_id", sessionId);
        params.set("include_summaries", "true");
        return this.get(`/memories/${this.memoryId}/timeline`, params);
    }
    async getHandoffContext(query) {
        const params = new URLSearchParams({
            days: "3",
            max_cards: "5",
            max_tasks: "10",
        });
        if (this.agentRole)
            params.set("agent_role", this.agentRole);
        const ctx = await this.get(`/memories/${this.memoryId}/context`, params);
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
    async getRules(params) {
        const qs = new URLSearchParams();
        if (params.format !== undefined)
            qs.set("format", String(params.format));
        if (this.agentRole)
            qs.set("agent_role", this.agentRole);
        return this.get(`/memories/${this.memoryId}/rules`, qs);
    }
    async getGraph(params) {
        const qs = new URLSearchParams();
        if (params.limit !== undefined)
            qs.set("limit", String(params.limit));
        if (params.entity_type !== undefined)
            qs.set("entity_type", String(params.entity_type));
        if (params.search !== undefined)
            qs.set("search", String(params.search));
        // If entity_id is given, fetch neighbors; otherwise list entities
        if (params.entity_id) {
            if (params.max_hops !== undefined)
                qs.set("max_hops", String(params.max_hops));
            return this.get(`/memories/${this.memoryId}/graph/entities/${String(params.entity_id)}/neighbors`, qs);
        }
        return this.get(`/memories/${this.memoryId}/graph/entities`, qs);
    }
    async getAgents() {
        return this.get(`/memories/${this.memoryId}/agents`);
    }
    // -----------------------------------------------------------------------
    // Internal — Write operations
    // -----------------------------------------------------------------------
    async rememberStep(text, metadata, userId) {
        const body = {
            memory_id: this.memoryId,
            content: text,
            session_id: this.sessionId,
        };
        if (this.agentRole)
            body.agent_role = this.agentRole;
        if (userId)
            body.user_id = userId;
        if (metadata)
            Object.assign(body, metadata);
        return this.post("/mcp/events", body);
    }
    async rememberBatch(steps, userId) {
        const body = {
            memory_id: this.memoryId,
            steps,
            session_id: this.sessionId,
        };
        if (this.agentRole)
            body.agent_role = this.agentRole;
        if (userId)
            body.user_id = userId;
        return this.post("/mcp/events/batch", body);
    }
    async ingestContent(content, contentScope, metadata) {
        const body = {
            memory_id: this.memoryId,
            content,
            content_scope: contentScope,
            session_id: this.sessionId,
        };
        if (this.agentRole)
            body.agent_role = this.agentRole;
        if (metadata)
            body.metadata = metadata;
        return this.post("/mcp/events", body);
    }
    async updateTask(taskId, status) {
        return this.patch(`/memories/${this.memoryId}/insights/action-items/${taskId}`, { status });
    }
    // -----------------------------------------------------------------------
    // Session lifecycle
    // -----------------------------------------------------------------------
    async closeSession() {
        const body = {
            memory_id: this.memoryId,
            session_id: this.sessionId,
            generate_summary: true,
        };
        if (this.agentRole)
            body.agent_role = this.agentRole;
        try {
            return await this.post("/mcp/events/batch", { ...body, steps: [], close_session: true });
        }
        catch {
            // Fallback: trigger summary via a lightweight sentinel event
            await this.rememberStep("[session-end]", {
                event_type: "session_end",
                source: "openclaw-plugin",
            });
            return { session_id: this.sessionId, events_processed: 0 };
        }
    }
    // -----------------------------------------------------------------------
    // Insight submission
    // -----------------------------------------------------------------------
    async submitInsights(content) {
        const body = {
            memory_id: this.memoryId,
            session_id: this.sessionId,
            insights: content,
        };
        if (this.agentRole)
            body.agent_role = this.agentRole;
        return this.post(`/memories/${this.memoryId}/insights/submit`, body);
    }
    // -----------------------------------------------------------------------
    // Backfill conversation history
    // -----------------------------------------------------------------------
    async backfillConversation(history, metadata) {
        const body = {
            memory_id: this.memoryId,
            session_id: this.sessionId,
            history,
            source: "openclaw-plugin",
            generate_summary: true,
            max_events: 800,
        };
        if (this.agentRole)
            body.agent_role = this.agentRole;
        if (metadata)
            body.metadata_defaults = metadata;
        return this.post("/mcp/events/backfill", body);
    }
    // -----------------------------------------------------------------------
    // Knowledge card management
    // -----------------------------------------------------------------------
    async supersedeCard(cardId) {
        return this.patch(`/memories/${this.memoryId}/insights/knowledge-cards/${cardId}/supersede`, {});
    }
    // -----------------------------------------------------------------------
    // Internal HTTP helpers
    // -----------------------------------------------------------------------
    headers() {
        return {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`,
        };
    }
    async get(path, params) {
        const qs = params && params.toString() ? `?${params.toString()}` : "";
        const url = `${this.baseUrl}${path}${qs}`;
        const response = await fetch(url, {
            method: "GET",
            headers: this.headers(),
        });
        if (!response.ok) {
            const detail = await this.extractErrorDetail(response);
            throw new Error(`Awareness API GET ${path} failed (${response.status}): ${detail}`);
        }
        return (await response.json());
    }
    async post(path, body) {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const detail = await this.extractErrorDetail(response);
            throw new Error(`Awareness API POST ${path} failed (${response.status}): ${detail}`);
        }
        return (await response.json());
    }
    async patch(path, body) {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
            method: "PATCH",
            headers: this.headers(),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const detail = await this.extractErrorDetail(response);
            throw new Error(`Awareness API PATCH ${path} failed (${response.status}): ${detail}`);
        }
        return (await response.json());
    }
    async extractErrorDetail(response) {
        try {
            const text = await response.text();
            try {
                const json = JSON.parse(text);
                return String(json.detail ?? json.message ?? json.error ?? text);
            }
            catch {
                return text || response.statusText;
            }
        }
        catch {
            return response.statusText;
        }
    }
}
exports.AwarenessClient = AwarenessClient;
