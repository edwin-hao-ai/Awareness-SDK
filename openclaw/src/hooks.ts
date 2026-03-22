import type { PluginApi, PluginConfig, HookContext, HookResult } from "./types";
import type { AwarenessClient } from "./client";

// ---------------------------------------------------------------------------
// Language-agnostic keyword extraction for full-text search (zero LLM cost)
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractKeywords(text: string, maxKeywords: number = 8): string {
  if (!text) return "";
  const tokens: string[] = [];
  // Quoted content
  for (const m of text.matchAll(/["\u201c]([^"\u201d]{2,40})["\u201d]/g)) tokens.push(m[1]);
  for (const m of text.matchAll(/'([^']{2,40})'/g)) tokens.push(m[1]);
  // File patterns
  for (const m of text.matchAll(
    /[\w.-]+\.(?:py|js|ts|tsx|jsx|yml|yaml|json|md|csv|xlsx|pdf|sql|go|rs|java|rb|sh|env|toml|cfg|conf|xml|html|css|txt|log)\b/gi,
  ))
    tokens.push(m[0]);
  // UPPER-case (acronyms, codes)
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]{1,15}\b/g)) tokens.push(m[0]);
  // camelCase
  for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) tokens.push(m[0]);
  // snake_case / kebab-case
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/g)) tokens.push(m[0]);
  // Numbers with context
  for (const m of text.matchAll(/[#vV]?\d[\d.,:-]+\w*/g)) tokens.push(m[0]);
  // CJK name+title
  for (const m of text.matchAll(
    /[\u4e00-\u9fff]{1,4}(?:\u603B|\u7ECF\u7406|\u8001\u5E08|\u90E8\u957F|\u4E3B\u4EFB|\u5148\u751F|\u5973\u58EB)/g,
  ))
    tokens.push(m[0]);
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

// ---------------------------------------------------------------------------
// Register lifecycle hooks for automatic memory recall & capture
// ---------------------------------------------------------------------------

export function registerHooks(
  api: PluginApi,
  client: AwarenessClient,
  config: PluginConfig,
): void {
  // -----------------------------------------------------------------------
  // before_agent_start — auto-recall context when a session begins
  // -----------------------------------------------------------------------
  if (config.autoRecall) {
    api.on("before_agent_start", async (context: unknown): Promise<HookResult | void> => {
        const ctx = context as HookContext | undefined;
        // Guard: context may be undefined in non-agent calls (e.g. plugins list)
        if (!ctx) return;
        const prompt = (ctx.prompt ?? "").trim();
        if (!prompt) {
          return;
        }

        try {
          // Initialize session and load context
          const { context: sessionCtx } = await client.init(
            7,
            config.recallLimit,
            config.recallLimit,
          );

          // Semantic search against the user prompt (with keyword extraction for full-text search)
          const keywords = extractKeywords(prompt);
          const recall = await client.search({
            semanticQuery: prompt,
            keywordQuery: keywords || undefined,
            limit: config.recallLimit,
            detail: "summary",
          });

          // Build the XML memory block to prepend
          const parts: string[] = ["<awareness-memory>"];

          // Active skills (high-priority, placed first)
          const activeSkills = (sessionCtx as any).active_skills ?? [];
          if (activeSkills.length > 0) {
            parts.push("  <skills>");
            for (const skill of activeSkills) {
              const title = escapeXml(skill.title ?? "");
              parts.push(`    <skill title="${title}">`);
              if (skill.summary) parts.push(`      ${skill.summary}`);
              parts.push("    </skill>");
            }
            parts.push("  </skills>");
          }

          // Last session summaries
          const lastSessions = sessionCtx.last_sessions ?? [];
          if (lastSessions.length > 0) {
            parts.push("  <last-sessions>");
            for (const session of lastSessions) {
              const date = (session as Record<string, unknown>).date ?? "unknown";
              const events = (session as Record<string, unknown>).event_count ?? 0;
              const summary = (session as Record<string, unknown>).summary ?? "";
              parts.push(
                `    <session date="${escapeXml(String(date))}" events="${events}">${escapeXml(String(summary))}</session>`,
              );
            }
            parts.push("  </last-sessions>");
          }

          // Recent narratives
          const days = sessionCtx.recent_days ?? [];
          if (days.length > 0) {
            parts.push("  <recent-progress>");
            for (const day of days) {
              if (day.narrative) {
                parts.push(
                  `    <day date="${escapeXml(day.date ?? "unknown")}">${escapeXml(day.narrative)}</day>`,
                );
              }
            }
            parts.push("  </recent-progress>");
          }

          // Open tasks
          const tasks = sessionCtx.open_tasks ?? [];
          if (tasks.length > 0) {
            parts.push("  <open-tasks>");
            for (const task of tasks) {
              parts.push(
                `    <task priority="${task.priority ?? "medium"}" status="${task.status ?? "pending"}">${escapeXml(task.title ?? "")}</task>`,
              );
            }
            parts.push("  </open-tasks>");
          }

          // Knowledge cards
          const cards = sessionCtx.knowledge_cards ?? [];
          if (cards.length > 0) {
            parts.push("  <knowledge>");
            for (const card of cards) {
              parts.push(
                `    <card category="${escapeXml(card.category ?? "")}">${escapeXml(card.title ?? "")}: ${escapeXml(card.summary ?? "")}</card>`,
              );
            }
            parts.push("  </knowledge>");
          }

          // Vector recall results (filter low-score noise)
          const results = (recall.results ?? []).filter(
            (r) => r.score === undefined || r.score === null || r.score >= 0.5
          );
          if (results.length > 0) {
            parts.push("  <recall>");
            for (const result of results) {
              if (result.content) {
                const score =
                  result.score !== undefined
                    ? ` score="${result.score.toFixed(3)}"`
                    : "";
                parts.push(`    <result${score}>${result.content}</result>`);
              }
            }
            parts.push("  </recall>");
          }

          parts.push("</awareness-memory>");

          const memoryBlock = parts.join("\n");
          api.logger.info(
            `Awareness auto-recall injected ${memoryBlock.length} chars (skills=${activeSkills.length}, sessions=${lastSessions.length}, recall=${results.length})`,
          );
          return { prependSystemContext: memoryBlock };
        } catch (err) {
          api.logger.warn(
            "Awareness auto-recall failed, continuing without memory context",
            err,
          );
          return;
        }
      },
    );
  }

  // -----------------------------------------------------------------------
  // agent_end — auto-capture conversation summary after the agent finishes
  // -----------------------------------------------------------------------
  if (config.autoCapture) {
    api.on("agent_end", async (context: unknown): Promise<void> => {
        const ctx = context as (HookContext & { messages?: unknown[] }) | undefined;
        // Guard: context may be undefined in non-agent calls; skip failed/incomplete runs
        if (!ctx) return;
        if (!ctx.success) return;
        const messages = ctx.messages ?? [];
        if (messages.length === 0) {
          return;
        }

        try {
          // Extract text from a message content value (string or content-blocks array)
          const extractText = (raw: unknown): string => {
            if (typeof raw === "string") return raw;
            if (Array.isArray(raw)) {
              return raw
                .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
                .filter((b) => b.type === "text" && typeof b.text === "string")
                .map((b) => b.text as string)
                .join("\n");
            }
            return "";
          };
          const cleanMsg = (raw: unknown) =>
            extractText(raw)
              .replace(/<awareness-memory>[\s\S]*?<\/awareness-memory>/g, "")
              .trim();

          let firstUserContent = "";
          let lastAssistantContent = "";
          let messageCount = 0;

          for (const msg of messages) {
            if (!msg || typeof msg !== "object") continue;
            const m = msg as unknown as Record<string, unknown>;
            const content = cleanMsg(m.content);
            if (content.length < 30) continue;
            messageCount++;
            const role = m.role ?? "unknown";
            if (role === "user" && !firstUserContent) {
              firstUserContent = content;
            }
            if (role === "assistant") {
              lastAssistantContent = content;
            }
          }

          if (messageCount === 0) {
            return;
          }

          // Build structured turn brief
          const parts: string[] = [];
          if (firstUserContent) {
            parts.push(`Request: ${firstUserContent.slice(0, 300)}`);
          }
          if (lastAssistantContent) {
            parts.push(`Result: ${lastAssistantContent.slice(0, 400)}`);
          }
          parts.push(`Turns: ${messageCount} messages`);
          const summary = parts.join("\n");

          await client.record(summary, {
            event_type: "turn_brief",
            source: "openclaw-plugin",
          });

          api.logger.info(
            `Awareness auto-capture: stored turn brief (${messageCount} messages)`,
          );

          // Close session and trigger insight extraction
          try {
            const result = await client.closeSession();
            if (result.events_processed >= 3) {
              api.logger.info(
                `Awareness: insight extraction triggered for session ${client.sessionId} (${result.events_processed} events)`,
              );
            }
          } catch (err) {
            api.logger.warn("Awareness: closeSession failed, insights will be generated on next query", err);
          }
        } catch (err) {
          api.logger.warn(
            "Awareness auto-capture failed, conversation not persisted",
            err,
          );
        }
      },
    );
  }
}
