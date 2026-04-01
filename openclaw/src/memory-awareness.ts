/**
 * OpenClaw Native Adapter
 *
 * Bridges the Awareness plugin to OpenClaw's real plugin API.
 * The core logic lives in client.ts/tools.ts/hooks.ts;
 * this file just adapts the registration and config parsing to match
 * the OpenClaw host runtime (api.pluginConfig, api.on, api.registerTool).
 */

import { AwarenessClient } from "./client";
import type {
  SessionContext,
  ActiveSkill,
  KnowledgeCard,
  ActionItem,
  VectorResult,
} from "./types";

// ---------------------------------------------------------------------------
// Config schema with parse() — matches OpenClaw convention
// ---------------------------------------------------------------------------

interface AwarenessPluginConfig {
  apiKey: string;
  baseUrl: string;
  memoryId: string;
  agentRole: string;
  autoRecall: boolean;
  autoCapture: boolean;
  recallLimit: number;
  /** Local daemon URL (e.g. http://localhost:37800). When set, apiKey/memoryId are optional. */
  localUrl?: string;
}

const awarenessConfigSchema = {
  parse(value: unknown): AwarenessPluginConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        "Awareness config required. Set plugins.entries.openclaw-memory.config in openclaw.json",
      );
    }
    const cfg = value as Record<string, unknown>;

    const localUrl = typeof cfg.localUrl === "string" && cfg.localUrl ? cfg.localUrl : undefined;
    const isLocalMode = !!localUrl;

    // In local mode, apiKey and memoryId are optional — the daemon handles auth internally.
    if (!isLocalMode) {
      if (typeof cfg.apiKey !== "string" || !cfg.apiKey) {
        throw new Error("apiKey is required in Awareness plugin config (or set localUrl for local daemon mode)");
      }
      if (typeof cfg.memoryId !== "string" || !cfg.memoryId) {
        throw new Error("memoryId is required in Awareness plugin config (or set localUrl for local daemon mode)");
      }
    }

    return {
      apiKey: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
      baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : "https://awareness.market/api/v1",
      memoryId: typeof cfg.memoryId === "string" ? cfg.memoryId : "local",
      agentRole: typeof cfg.agentRole === "string" ? cfg.agentRole : "builder_agent",
      autoRecall: cfg.autoRecall !== false,
      autoCapture: cfg.autoCapture !== false,
      recallLimit: typeof cfg.recallLimit === "number" ? cfg.recallLimit : 8,
      localUrl,
    };
  },
};

// ---------------------------------------------------------------------------
// Language-agnostic keyword extraction for full-text search (zero LLM cost)
// ---------------------------------------------------------------------------

function extractKeywords(text: string, maxKeywords = 8): string {
  if (!text) return "";
  const tokens: string[] = [];
  for (const m of text.matchAll(/["\u201c]([^"\u201d]{2,40})["\u201d]/g)) tokens.push(m[1]);
  for (const m of text.matchAll(/'([^']{2,40})'/g)) tokens.push(m[1]);
  for (const m of text.matchAll(
    /[\w.-]+\.(?:py|js|ts|tsx|jsx|yml|yaml|json|md|csv|xlsx|pdf|sql|go|rs|java|rb|sh|env|toml|cfg|conf|xml|html|css|txt|log)\b/gi,
  ))
    tokens.push(m[0]);
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]{1,15}\b/g)) tokens.push(m[0]);
  for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) tokens.push(m[0]);
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/g)) tokens.push(m[0]);

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

// ---------------------------------------------------------------------------
// Build XML memory block for context injection
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildMemoryBlock(
  sessionCtx: SessionContext,
  recallResults: VectorResult[],
): string {
  const parts: string[] = ["<awareness-memory>"];

  // Skills are placed first (high-priority context, pre-loaded at session start)
  const activeSkills: ActiveSkill[] = (sessionCtx as any).active_skills ?? [];
  if (activeSkills.length > 0) {
    parts.push("  <skills>");
    for (const skill of activeSkills) {
      const title = escapeXml(skill.title ?? "");
      parts.push(`    <skill title="${title}">`);
      if (skill.summary) {
        parts.push(`      ${skill.summary}`);
      }
      parts.push("    </skill>");
    }
    parts.push("  </skills>");
  }

  const lastSessions = sessionCtx.last_sessions ?? [];
  if (lastSessions.length > 0) {
    parts.push("  <last-sessions>");
    for (const session of lastSessions) {
      const s = session as Record<string, unknown>;
      parts.push(
        `    <session date="${s.date ?? "unknown"}" events="${s.event_count ?? 0}">${s.summary ?? ""}</session>`,
      );
    }
    parts.push("  </last-sessions>");
  }

  const days = sessionCtx.recent_days ?? [];
  if (days.length > 0) {
    parts.push("  <recent-progress>");
    for (const day of days) {
      if (day.narrative) {
        parts.push(`    <day date="${day.date ?? "unknown"}">${day.narrative}</day>`);
      }
    }
    parts.push("  </recent-progress>");
  }

  // Attention protocol — when needs_attention is true, instruct the LLM to act
  const attention = (sessionCtx as any).attention_summary;
  if (attention?.needs_attention) {
    parts.push("  <attention-protocol>");
    parts.push(`    <summary stale_tasks="${attention.stale_tasks ?? 0}" high_risks="${attention.high_risks ?? 0}" total_open="${attention.total_open_tasks ?? 0}" />`);
    parts.push("    <instructions>");
    parts.push("      Review all open tasks and risks below. For stale tasks (pending > 3 days), remind the user or suggest completion/removal.");
    parts.push("      For high risks, warn the user before starting work. Update resolved items via awareness_record.");
    parts.push("    </instructions>");
    parts.push("  </attention-protocol>");
  }

  const tasks = sessionCtx.open_tasks ?? [];
  if (tasks.length > 0) {
    parts.push("  <open-tasks>");
    for (const task of tasks) {
      parts.push(
        `    <task priority="${task.priority ?? "medium"}" status="${task.status ?? "pending"}">${task.title ?? ""}</task>`,
      );
    }
    parts.push("  </open-tasks>");
  }

  const cards = sessionCtx.knowledge_cards ?? [];
  if (cards.length > 0) {
    parts.push("  <knowledge>");
    for (const card of cards) {
      parts.push(
        `    <card category="${card.category ?? ""}">${card.title ?? ""}: ${card.summary ?? ""}</card>`,
      );
    }
    parts.push("  </knowledge>");
  }

  const filtered = recallResults.filter(
    (r) => r.score === undefined || r.score === null || r.score >= 0.5,
  );
  if (filtered.length > 0) {
    parts.push("  <recall>");
    for (const result of filtered) {
      if (result.content) {
        const score = result.score !== undefined ? ` score="${result.score.toFixed(3)}"` : "";
        parts.push(`    <result${score}>${result.content}</result>`);
      }
    }
    parts.push("  </recall>");
  }

  parts.push("</awareness-memory>");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Plugin object — exported as default for OpenClaw host
// ---------------------------------------------------------------------------

// Use `any` for the OpenClaw API since we don't have their type package
/* eslint-disable @typescript-eslint/no-explicit-any */

const awarenessPlugin = {
  id: "openclaw-memory",
  name: "Awareness Memory",
  description: "Cloud-backed long-term memory with knowledge cards, tasks, and structured recall",
  kind: "memory" as const,
  configSchema: awarenessConfigSchema,

  register(api: any) {
    // pluginConfig = plugin-specific config; config may be entire openclaw.json
    const cfg = awarenessConfigSchema.parse(api.pluginConfig ?? api.config);

    // Local mode: route through the daemon's API (no cloud auth required).
    // AwarenessClient auto-detects local mode when apiKey is empty + URL is localhost.
    const effectiveBaseUrl = cfg.localUrl
      ? `${cfg.localUrl.replace(/\/$/, "")}/api/v1`
      : cfg.baseUrl;
    const effectiveApiKey = cfg.localUrl ? "" : cfg.apiKey;

    const client = new AwarenessClient(effectiveBaseUrl, effectiveApiKey, cfg.memoryId, cfg.agentRole);

    api.logger.info(
      `awareness: plugin registered (mode=${cfg.localUrl ? "local" : "cloud"}, memory=${cfg.memoryId}, role=${cfg.agentRole}, ` +
        `autoRecall=${cfg.autoRecall}, autoCapture=${cfg.autoCapture})`,
    );

    // =====================================================================
    // Tool 1: awareness_recall — cross-session search
    // =====================================================================
    api.registerTool(
      {
        name: "awareness_recall",
        label: "Awareness Recall",
        description:
          "Search cross-session persistent memory — past decisions, knowledge, history.\n" +
          "Rewrite query: semantic_query=full question, keyword_query=2-5 precise terms.\n" +
          "Modes: auto (default) | precise | session | structured (DB-only, fast) | hybrid (DB + vectors).",
        parameters: {
          type: "object",
          properties: {
            semantic_query: {
              type: "string",
              description: "Expanded natural-language question for vector search.",
            },
            keyword_query: {
              type: "string",
              description: "2-5 precise terms for full-text matching.",
            },
            scope: {
              type: "string",
              enum: ["all", "timeline", "knowledge", "insights"],
              description: "Layer to search.",
            },
            limit: {
              type: "integer",
              description: "Max results (default 6, max 30).",
            },
            recall_mode: {
              type: "string",
              enum: ["precise", "session", "structured", "hybrid", "auto"],
              description: "Recall strategy.",
            },
          },
          required: ["semantic_query"],
        },
        async execute(_toolCallId: string, params: any) {
          const result = await client.search({
            semanticQuery: String(params.semantic_query ?? ""),
            keywordQuery: params.keyword_query ? String(params.keyword_query) : undefined,
            scope: params.scope ?? "all",
            limit: params.limit ? Number(params.limit) : 6,
            recallMode: params.recall_mode ?? "auto",
          });

          const results = result.results ?? [];
          if (results.length === 0) {
            return {
              content: [{ type: "text", text: "No relevant memories found." }],
              details: { count: 0 },
            };
          }

          const text = results
            .map((r: any, i: number) => {
              const score = r.score !== undefined ? ` (${(r.score * 100).toFixed(0)}%)` : "";
              return `${i + 1}. ${r.content}${score}`;
            })
            .join("\n\n");

          return {
            content: [
              { type: "text", text: `Found ${results.length} memories:\n\n${text}` },
            ],
            details: { count: results.length },
          };
        },
      },
    );

    // =====================================================================
    // Tool 2: awareness_lookup — structured DB query (no vectors)
    // =====================================================================
    api.registerTool(
      {
        name: "awareness_lookup",
        label: "Awareness Lookup",
        description:
          "Look up structured data from persistent memory — pure DB, <50ms.\n" +
          "TYPE: context | tasks | knowledge | risks | timeline | handoff",
        parameters: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["context", "tasks", "knowledge", "risks", "timeline", "handoff"],
              description: "Type of data to retrieve.",
            },
            query: { type: "string", description: "Keyword filter." },
            category: { type: "string", description: "Category filter." },
            status: { type: "string", description: "Status filter." },
            priority: { type: "string", description: "Priority filter." },
            limit: { type: "integer", description: "Max items (default 20)." },
          },
          required: ["type"],
        },
        async execute(_toolCallId: string, params: any) {
          const result = await client.getData(String(params.type ?? "context"), params);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            details: result,
          };
        },
      },
    );

    // =====================================================================
    // Tool 3: awareness_record — write to persistent memory
    // =====================================================================
    api.registerTool(
      {
        name: "awareness_record",
        label: "Awareness Record",
        description:
          "Record events to cross-session persistent memory.\n" +
          "ACTIONS: remember (single event) | remember_batch (session-end summary) | " +
          "update_task | submit_insights\n" +
          "Write detailed content — include reasoning, code snippets, user quotes, files changed.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["remember", "remember_batch", "update_task", "submit_insights"],
              description: "Write action.",
            },
            text: { type: "string", description: "Event text." },
            steps: {
              type: "array",
              items: { type: "object", properties: { text: { type: "string" } } },
              description: "Array for remember_batch.",
            },
            content: { description: "Content for submit_insights." },
            task_id: { type: "string", description: "Task ID for update_task." },
            status: { type: "string", description: "New status for update_task." },
          },
          required: ["action"],
        },
        async execute(_toolCallId: string, params: any) {
          const result = await client.write(String(params.action ?? "remember"), params);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: result,
          };
        },
      },
    );

    // =====================================================================
    // Auto-recall hook
    // =====================================================================
    if (cfg.autoRecall) {
      let _recallFired = "";
      const autoRecallHandler = async (event: any) => {
        // Guard: event may be undefined in non-agent calls (e.g. plugins list)
        if (!event) return;
        const prompt = (event.prompt ?? "").trim();
        if (!prompt || prompt.length < 5) return;
        // Dedup: both hooks may fire in transition versions
        if (_recallFired === prompt) return;
        _recallFired = prompt;

        try {
          const { context: sessionCtx } = await client.init(
            7,
            cfg.recallLimit,
            cfg.recallLimit,
          );

          const keywords = extractKeywords(prompt);
          const recall = await client.search({
            semanticQuery: prompt,
            keywordQuery: keywords || undefined,
            limit: cfg.recallLimit,
            // Exclude Claude Code MCP dev memories from chat context injection
            sourceExclude: ['mcp'],
          });

          const memoryBlock = buildMemoryBlock(sessionCtx, recall.results ?? []);

          api.logger.info(
            `awareness: auto-recall injected ${memoryBlock.length} chars of context`,
          );

          return { prependContext: memoryBlock };
        } catch (err) {
          api.logger.warn(`awareness: auto-recall failed: ${String(err)}`);
        }
      };
      // Register on both hook names for old/new OpenClaw compatibility
      api.on("before_prompt_build", autoRecallHandler);
      api.on("before_agent_start", autoRecallHandler);
    }

    // =====================================================================
    // Auto-capture hook
    // =====================================================================
    if (cfg.autoCapture) {
      api.on("agent_end", async (event: any) => {
        // Guard: event may be undefined in non-agent calls
        if (!event) return;
        const messages = event.messages ?? [];
        if (!event.success || messages.length === 0) return;

        try {
          const cleanMsg = (content: string) =>
            content
              .replace(/<awareness-memory>[\s\S]*?<\/awareness-memory>/g, "")
              .trim();

          let firstUserContent = "";
          let lastAssistantContent = "";
          let messageCount = 0;

          for (const msg of messages) {
            if (!msg || typeof msg !== "object") continue;
            const m = msg as Record<string, unknown>;
            const content = typeof m.content === "string" ? cleanMsg(m.content) : "";
            if (content.length < 30) continue;
            messageCount++;
            if (m.role === "user" && !firstUserContent) firstUserContent = content;
            if (m.role === "assistant") lastAssistantContent = content;
          }

          if (messageCount === 0) return;

          const parts: string[] = [];
          if (firstUserContent) parts.push(`Request: ${firstUserContent.slice(0, 300)}`);
          if (lastAssistantContent) parts.push(`Result: ${lastAssistantContent.slice(0, 400)}`);
          parts.push(`Turns: ${messageCount} messages`);

          await client.record(parts.join("\n"), {
            event_type: "turn_brief",
            source: "openclaw-plugin",
          });

          try {
            const result = await client.closeSession();
            if (result.events_processed >= 3) {
              api.logger.info(
                `awareness: insight extraction triggered (${result.events_processed} events)`,
              );
            }
          } catch (err) {
            api.logger.warn(`awareness: closeSession failed: ${String(err)}`);
          }

          api.logger.info(
            `awareness: auto-capture stored turn brief (${messageCount} messages)`,
          );
        } catch (err) {
          api.logger.warn(`awareness: auto-capture failed: ${String(err)}`);
        }
      });
    }
  },
};

export default awarenessPlugin;
