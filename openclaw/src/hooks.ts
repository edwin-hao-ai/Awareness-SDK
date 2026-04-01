import type { PluginApi, PluginConfig, HookContext, HookResult, PerceptionSignal } from "./types";
import type { AwarenessClient } from "./client";
import * as fs from "fs";
import * as path from "path";
import { syncDailyLog } from "./sync";

// ---------------------------------------------------------------------------
// Language-agnostic keyword extraction for full-text search (zero LLM cost)
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
// Capture dedup — prevent recording identical summaries within a time window
// ---------------------------------------------------------------------------

const _captureHashCache = new Map<string, number>();
const CAPTURE_DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function shouldCapture(content: string): boolean {
  const now = Date.now();
  // Clean expired entries
  for (const [k, ts] of _captureHashCache) {
    if (now - ts > CAPTURE_DEDUP_WINDOW_MS) _captureHashCache.delete(k);
  }
  // Composite key: first 120 chars + length — near-zero collision probability
  const key = `${content.slice(0, 120)}|${content.length}`;
  if (_captureHashCache.has(key)) return false;
  _captureHashCache.set(key, now);
  return true;
}

// ---------------------------------------------------------------------------
// Perception cache — bridge between record (write) and recall (read)
// Signals are written by auto-capture / tool calls, read by auto-recall.
// ---------------------------------------------------------------------------

const PERCEPTION_CACHE_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".awareness",
  "perception-cache.json",
);
const PERCEPTION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const PERCEPTION_MAX_ITEMS = 10;

/** Append perception signals to the local cache file. */
function cachePerception(signals: PerceptionSignal[]): void {
  if (!signals || signals.length === 0) return;
  try {
    const dir = path.dirname(PERCEPTION_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let existing: Array<PerceptionSignal & { _ts?: number }> = [];
    try { existing = JSON.parse(fs.readFileSync(PERCEPTION_CACHE_FILE, "utf8")); } catch { /* empty */ }
    const updated = [
      ...signals.map((s) => ({ ...s, _ts: Date.now() })),
      ...existing,
    ].slice(0, PERCEPTION_MAX_ITEMS);
    fs.writeFileSync(PERCEPTION_CACHE_FILE, JSON.stringify(updated), "utf8");
  } catch { /* best-effort */ }
}

/** Read and consume cached perception signals (clears after read). */
function consumePerception(): Array<PerceptionSignal & { _ts?: number }> {
  try {
    if (!fs.existsSync(PERCEPTION_CACHE_FILE)) return [];
    const cached: Array<PerceptionSignal & { _ts?: number }> = JSON.parse(
      fs.readFileSync(PERCEPTION_CACHE_FILE, "utf8"),
    );
    const cutoff = Date.now() - PERCEPTION_MAX_AGE_MS;
    const recent = (cached || []).filter((s) => (s._ts || 0) > cutoff);
    // Clear consumed signals
    fs.writeFileSync(PERCEPTION_CACHE_FILE, "[]", "utf8");
    return recent.slice(0, 5);
  } catch {
    return [];
  }
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
  // Auto-recall context when a session begins.
  // Register on BOTH hook names for compatibility:
  //   - "before_prompt_build" (OpenClaw >= 2026.3.22, preferred)
  //   - "before_agent_start" (OpenClaw < 2026.3.22, deprecated but still works)
  // Only one will fire per session — a dedup flag prevents double execution.
  // -----------------------------------------------------------------------
  if (config.autoRecall) {
    let _recallFiredForPrompt = "";
    const autoRecallHandler = async (context: unknown): Promise<HookResult | void> => {
        const ctx = context as HookContext | undefined;
        // Guard: context may be undefined in non-agent calls (e.g. plugins list)
        if (!ctx) return;
        const prompt = (ctx.prompt ?? "").trim();
        if (!prompt) {
          return;
        }
        // Dedup: both hooks may fire in transition versions — only run once per prompt
        if (_recallFiredForPrompt === prompt) return;
        _recallFiredForPrompt = prompt;

        try {
          // Initialize session and load context
          const { context: sessionCtx } = await client.init(
            7,
            config.recallLimit,
            config.recallLimit,
          );

          // Consume perception signals (client-side only, must happen before XML build)
          const perceptionSignals = consumePerception();

          // -----------------------------------------------------------------
          // Fast path: use server-side rendered_context when available
          // -----------------------------------------------------------------
          if (sessionCtx.rendered_context) {
            let xml = sessionCtx.rendered_context;

            // Append perception signals (client-side only, not in server render)
            if (perceptionSignals.length > 0) {
              const pParts: string[] = [];
              pParts.push("  <perception>");
              pParts.push("    <action-required>BEFORE responding to the user, you MUST address each signal below. For contradictions: inform the user and ask if intentional. For resonance: mention the related past experience. For patterns: suggest a systematic fix. For staleness: warn knowledge may be outdated. For guards: STOP and warn about the known pitfall.</action-required>");
              for (const s of perceptionSignals) {
                pParts.push(`    <signal type="${escapeXml(s.type ?? "")}">${escapeXml(s.message ?? "")}</signal>`);
              }
              pParts.push("  </perception>");
              xml = xml.replace("</awareness-memory>", pParts.join("\n") + "\n</awareness-memory>");
            }

            // Append record-rule for OpenClaw (tools.ts handles the actual save)
            xml = xml.replace("</awareness-memory>", [
              "  <record-rule>",
              "    After significant work (decisions, solutions, pitfalls, user preferences), call awareness_record to persist.",
              "    NOT every small edit — only meaningful changes worth remembering across sessions.",
              "  </record-rule>",
              "</awareness-memory>",
            ].join("\n"));

            // One-time dashboard welcome for local mode
            const welcomeFile = path.join(
              process.env.HOME || process.env.USERPROFILE || "",
              ".awareness",
              "dashboard-welcomed",
            );
            if (client.isLocal && !fs.existsSync(welcomeFile)) {
              const dashUrl = config.localUrl.replace(/\/api\/v1$/, "");
              xml = xml.replace("</awareness-memory>", `  <dashboard>Memory is running locally. View and search your memories at ${escapeXml(dashUrl)}</dashboard>\n</awareness-memory>`);
              try { fs.writeFileSync(welcomeFile, "1", "utf8"); } catch { /* best-effort */ }
            }

            api.logger.info(
              `Awareness auto-recall injected ${xml.length} chars (server-rendered, perception=${perceptionSignals.length})`,
            );
            return { prependSystemContext: xml };
          }

          // -----------------------------------------------------------------
          // Fallback: build XML client-side (server didn't provide rendered_context)
          // -----------------------------------------------------------------

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
          const activeSkills = (sessionCtx as Record<string, unknown>).active_skills as Array<Record<string, string>> ?? [];
          if (activeSkills.length > 0) {
            parts.push("  <skills>");
            for (const skill of activeSkills) {
              parts.push(`    <skill title="${escapeXml(skill.title ?? "")}">${escapeXml(skill.summary ?? "")}</skill>`);
            }
            parts.push("  </skills>");
          }

          // User preferences — surfaced before everything else for identity & style context
          const userPrefs = sessionCtx.user_preferences ?? [];
          if (userPrefs.length > 0) {
            parts.push("  <who-you-are>");
            for (const pref of userPrefs) {
              parts.push(
                `    <pref category="${escapeXml(pref.category ?? "")}">${escapeXml(pref.title ?? "")}: ${escapeXml(pref.summary ?? "")}</pref>`,
              );
            }
            parts.push("  </who-you-are>");
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

          // Attention protocol — instruct LLM to act on stale tasks / high risks
          const attention = (sessionCtx as Record<string, unknown>).attention_summary as Record<string, unknown> | undefined;
          if (attention?.needs_attention) {
            parts.push("  <attention-protocol>");
            parts.push(`    <summary stale_tasks="${attention.stale_tasks ?? 0}" high_risks="${attention.high_risks ?? 0}" total_open="${attention.total_open_tasks ?? 0}" />`);
            parts.push("    <instructions>");
            parts.push("      Review all open tasks and risks below. For stale tasks (pending > 3 days), remind the user or suggest completion/removal.");
            parts.push("      For high risks, warn the user before starting work. Update resolved items via awareness_record.");
            parts.push("    </instructions>");
            parts.push("  </attention-protocol>");
          }

          // Open tasks
          const tasks = sessionCtx.open_tasks ?? [];
          if (tasks.length > 0) {
            parts.push("  <open-tasks>");
            for (const task of tasks) {
              parts.push(
                `    <task priority="${escapeXml(task.priority ?? "medium")}" status="${escapeXml(task.status ?? "pending")}">${escapeXml(task.title ?? "")}</task>`,
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

          // Vector recall results (filter low-score noise, with aha detection)
          const results = (recall.results ?? []).filter(
            (r) => r.score === undefined || r.score === null || r.score >= 0.35
          );
          if (results.length > 0) {
            parts.push("  <recall>");
            const now = Date.now();
            for (const result of results) {
              const content = escapeXml((result.content ?? "").slice(0, 300));
              if (!content) continue;
              const score = result.score ?? 0;

              // Aha detection: high-score old result = rediscovered knowledge
              let daysAgo = 0;
              const createdAt = (result.metadata as Record<string, unknown> | undefined)?.created_at;
              if (createdAt) {
                try {
                  daysAgo = Math.floor((now - new Date(String(createdAt)).getTime()) / 86400000);
                } catch { /* ignore */ }
              }

              if (score > 0.8 && daysAgo > 3) {
                parts.push(`    <aha score="${score.toFixed(2)}" days-ago="${daysAgo}">${content}</aha>`);
              } else {
                const scoreAttr = score ? ` score="${score.toFixed(2)}"` : "";
                parts.push(`    <result${scoreAttr}>${content}</result>`);
              }
            }
            parts.push("  </recall>");
          }

          // Perception signals from previous records (Eywa Whisper)
          if (perceptionSignals.length > 0) {
            parts.push("  <perception>");
            parts.push("    <action-required>BEFORE responding to the user, you MUST address each signal below. For contradictions: inform the user and ask if intentional. For resonance: mention the related past experience. For patterns: suggest a systematic fix. For staleness: warn knowledge may be outdated. For guards: STOP and warn about the known pitfall.</action-required>");
            for (const s of perceptionSignals) {
              parts.push(`    <signal type="${escapeXml(s.type ?? "")}">${escapeXml(s.message ?? "")}</signal>`);
            }
            parts.push("  </perception>");
          }

          // Record-rule — guide LLM on when to auto-save
          parts.push("  <record-rule>");
          parts.push("    After significant work (decisions, solutions, pitfalls, user preferences), call awareness_record to persist.");
          parts.push("    NOT every small edit — only meaningful changes worth remembering across sessions.");
          parts.push("  </record-rule>");

          // One-time dashboard welcome: tell user about the local dashboard on first use
          const welcomeFile = path.join(
            process.env.HOME || process.env.USERPROFILE || "",
            ".awareness",
            "dashboard-welcomed",
          );
          if (client.isLocal && !fs.existsSync(welcomeFile)) {
            const dashUrl = config.localUrl.replace(/\/api\/v1$/, "");
            parts.push(`  <dashboard>Memory is running locally. View and search your memories at ${escapeXml(dashUrl)}</dashboard>`);
            try { fs.writeFileSync(welcomeFile, "1", "utf8"); } catch { /* best-effort */ }
          }

          parts.push("</awareness-memory>");

          const memoryBlock = parts.join("\n");
          api.logger.info(
            `Awareness auto-recall injected ${memoryBlock.length} chars (client-rendered, skills=${activeSkills.length}, sessions=${lastSessions.length}, recall=${results.length}, perception=${perceptionSignals.length})`,
          );
          return { prependSystemContext: memoryBlock };
        } catch (err) {
          api.logger.warn(
            "Awareness auto-recall failed, continuing without memory context",
            err,
          );
          return;
        }
    };
    // Register on both hook names — only one will fire per session (dedup above)
    api.on("before_prompt_build", autoRecallHandler);
    api.on("before_agent_start", autoRecallHandler);
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

          // captureMinTurns: skip capture if conversation is too short
          if (config.captureMinTurns && messageCount < config.captureMinTurns) {
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

          // Content-hash dedup: skip if identical summary was captured recently
          if (!shouldCapture(summary)) {
            return;
          }

          // Detect channel source from context (Gateway passes channel info)
          const ctxAny = ctx as Record<string, unknown>;
          const channel = (ctxAny.channel ?? ctxAny.channelId ?? ctxAny.source ?? "") as string;
          const captureSource = channel ? `openclaw-${channel}` : "openclaw-plugin";

          const captureResult = await client.record(summary, {
            event_type: "turn_brief",
            source: captureSource,
          });

          // Cache perception signals for next recall injection
          const perception = (captureResult as Record<string, unknown>)?.perception;
          if (Array.isArray(perception) && perception.length > 0) {
            cachePerception(perception as PerceptionSignal[]);
            api.logger.info(
              `Awareness perception: cached ${perception.length} signals`,
            );
          }

          // Sync to OpenClaw Markdown (memory/YYYY-MM-DD.md)
          syncDailyLog(summary, "openclaw-plugin");

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
