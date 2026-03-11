import type { PluginApi, PluginConfig, HookContext, HookResult } from "./types";
import type { AwarenessClient } from "./client";

// ---------------------------------------------------------------------------
// Language-agnostic keyword extraction for full-text search (zero LLM cost)
// ---------------------------------------------------------------------------

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
    api.registerHook(
      "before_agent_start",
      async (context: HookContext): Promise<HookResult | void> => {
        const prompt = (context.prompt ?? "").trim();
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
          });

          // Build the XML memory block to prepend
          const parts: string[] = ["<awareness-memory>"];

          // Last session summaries
          const lastSessions = sessionCtx.last_sessions ?? [];
          if (lastSessions.length > 0) {
            parts.push("  <last-sessions>");
            for (const session of lastSessions) {
              const date = (session as Record<string, unknown>).date ?? "unknown";
              const events = (session as Record<string, unknown>).event_count ?? 0;
              const summary = (session as Record<string, unknown>).summary ?? "";
              parts.push(
                `    <session date="${date}" events="${events}">${summary}</session>`,
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
                  `    <day date="${day.date ?? "unknown"}">${day.narrative}</day>`,
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
                `    <task priority="${task.priority ?? "medium"}" status="${task.status ?? "pending"}">${task.title ?? ""}</task>`,
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
                `    <card category="${card.category ?? ""}">${card.title ?? ""}: ${card.summary ?? ""}</card>`,
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
          // Prefer prependSystemContext (OpenClaw 2026.3.7+) to avoid overwriting system prompt;
          // fall back to systemPrompt replacement for older hosts.
          return {
            prependSystemContext: memoryBlock,
            systemPrompt: memoryBlock + "\n\n" + (context.systemPrompt ?? ""),
          };
        } catch (err) {
          api.logger.warn(
            "Awareness auto-recall failed, continuing without memory context",
            err,
          );
          return;
        }
      },
      { priority: 10 },
    );
  }

  // -----------------------------------------------------------------------
  // agent_end — auto-capture conversation summary after the agent finishes
  // -----------------------------------------------------------------------
  if (config.autoCapture) {
    api.registerHook(
      "agent_end",
      async (context: HookContext): Promise<void> => {
        const messages = context.messages ?? [];
        if (messages.length === 0) {
          return;
        }

        try {
          // Extract first user request and last assistant result for structured brief
          const cleanMsg = (content: string) =>
            content.replace(/<awareness-memory>[\s\S]*?<\/awareness-memory>/g, "").trim();

          let firstUserContent = "";
          let lastAssistantContent = "";
          let messageCount = 0;

          for (const msg of messages) {
            const content = cleanMsg(msg.content ?? "");
            if (content.length < 30) continue;
            messageCount++;
            const role = msg.role ?? "unknown";
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

          await client.rememberStep(summary, {
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
      { priority: 90 },
    );
  }
}
