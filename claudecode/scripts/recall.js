#!/usr/bin/env node
// ---------------------------------------------------------------------------
// UserPromptSubmit hook — Auto-recall: search memory and inject context
// Protocol: receives JSON on stdin, outputs context text on stdout
// ---------------------------------------------------------------------------

const { loadConfig, resolveEndpoint, mcpCall, apiGet, apiPost, readStdin } = require("./shared");

// ---------------------------------------------------------------------------
// Keyword extraction (zero LLM cost)
// ---------------------------------------------------------------------------

function extractKeywords(text, max = 8) {
  if (!text) return "";
  const tokens = [];
  for (const m of text.matchAll(/[""\u201C](.*?)[""\u201D]/g)) tokens.push(m[1]);
  for (const m of text.matchAll(/[\w.-]+\.(?:py|js|ts|tsx|json|md|sql|go|rs|java|sh)\b/gi)) tokens.push(m[0]);
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]{1,15}\b/g)) tokens.push(m[0]);
  for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) tokens.push(m[0]);
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/g)) tokens.push(m[0]);
  const seen = new Set();
  const result = [];
  for (const t of tokens) {
    const k = t.trim().toLowerCase();
    if (k.length < 2 || seen.has(k)) continue;
    seen.add(k);
    result.push(t.trim());
    if (result.length >= max) break;
  }
  return result.join(" ");
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let input = {};
  try { input = await readStdin(); } catch { /* no stdin */ }

  const prompt = input.prompt || "";
  if (!prompt) process.exit(0);

  const config = loadConfig();
  const ep = await resolveEndpoint(config);
  if (!ep) process.exit(0);

  try {
    let ctx, recall;

    const keywords = extractKeywords(prompt);

    if (ep.mode === "local") {
      // Local daemon: parallel MCP calls (6s timeout each, hook has 15s)
      [ctx, recall] = await Promise.all([
        mcpCall(ep.localUrl, "awareness_init", { source: "awareness-skill" }, 6000),
        mcpCall(ep.localUrl, "awareness_recall", {
          semantic_query: prompt,
          keyword_query: keywords || undefined,
          detail: "summary",
          limit: config.recallLimit,
        }, 6000),
      ]);
    } else {
      // Cloud: parallel REST calls (6s timeout each)
      const params = new URLSearchParams({
        days: "7",
        max_cards: String(config.recallLimit),
        max_tasks: String(config.recallLimit),
      });
      if (config.agentRole) params.set("agent_role", config.agentRole);

      [ctx, recall] = await Promise.all([
        apiGet(ep.baseUrl, ep.apiKey, `/memories/${ep.memoryId}/context`, params),
        apiPost(ep.baseUrl, ep.apiKey, `/memories/${ep.memoryId}/retrieve`, {
          query: prompt,
          keyword_query: keywords || undefined,
          recall_mode: "hybrid",
          custom_kwargs: {
            limit: config.recallLimit,
            use_hybrid_search: true,
            reconstruct_chunks: true,
            vector_weight: 0.7,
            bm25_weight: 0.3,
          },
          include_installed: true,
          agent_role: config.agentRole || undefined,
          detail: "summary",
        }),
      ]);
    }

    // Build XML memory block
    const parts = ["<awareness-memory>"];

    const skills = ctx.active_skills || [];
    if (skills.length > 0) {
      parts.push("  <skills>");
      for (const s of skills) {
        parts.push(`    <skill title="${esc(s.title)}">`);
        if (s.summary) parts.push(`      ${s.summary}`);
        parts.push("    </skill>");
      }
      parts.push("  </skills>");
    }

    const sessions = ctx.last_sessions || ctx.recent_sessions || [];
    if (sessions.length > 0) {
      parts.push("  <last-sessions>");
      for (const s of sessions) {
        const date = s.date || s.started_at || "";
        const events = s.event_count || s.memory_count || 0;
        parts.push(`    <session date="${esc(date)}" events="${events}">${esc(s.summary || "")}</session>`);
      }
      parts.push("  </last-sessions>");
    }

    const days = ctx.recent_days || [];
    if (days.length > 0) {
      parts.push("  <recent-progress>");
      for (const d of days) {
        if (d.narrative) parts.push(`    <day date="${esc(d.date)}">${esc(d.narrative)}</day>`);
      }
      parts.push("  </recent-progress>");
    }

    const attn = ctx.attention_summary;
    if (attn?.needs_attention) {
      parts.push("  <attention-protocol>");
      parts.push(`    <summary stale_tasks="${attn.stale_tasks || 0}" high_risks="${attn.high_risks || 0}" />`);
      parts.push("  </attention-protocol>");
    }

    const tasks = ctx.open_tasks || [];
    if (tasks.length > 0) {
      parts.push("  <open-tasks>");
      for (const t of tasks) {
        parts.push(`    <task priority="${t.priority || "medium"}" status="${t.status || "pending"}">${esc(t.title)}</task>`);
      }
      parts.push("  </open-tasks>");
    }

    const cards = ctx.knowledge_cards || [];
    if (cards.length > 0) {
      parts.push("  <knowledge>");
      for (const c of cards) {
        parts.push(`    <card category="${esc(c.category)}">${esc(c.title)}: ${esc(c.summary)}</card>`);
      }
      parts.push("  </knowledge>");
    }

    // Parse recall results (local MCP returns text, cloud returns JSON)
    let results = [];
    if (recall) {
      if (typeof recall === "string") {
        // MCP text response - extract what we can
        results = [];
      } else {
        results = (recall.results || []).filter((r) => !r.score || r.score >= 0.5);
      }
    }
    if (results.length > 0) {
      parts.push("  <recall>");
      for (const r of results) {
        if (r.content) {
          const score = r.score ? ` score="${r.score.toFixed(3)}"` : "";
          parts.push(`    <result${score}>${r.content}</result>`);
        }
      }
      parts.push("  </recall>");
    }

    // Inject auto-record instructions so Claude saves insights without user asking
    parts.push("  <auto-record-rule>");
    parts.push("    MANDATORY: After completing significant work, save to memory SILENTLY:");
    parts.push('    node "${CLAUDE_PLUGIN_ROOT}/scripts/save-memory.js" \'<JSON>\'');
    parts.push("    If CLAUDE_PLUGIN_ROOT is not set: node ~/.claude/plugins/cache/awareness/awareness-memory/0.1.0/scripts/save-memory.js");
    parts.push("");
    parts.push("    JSON format: {\"content\":\"<detailed description>\",\"cards\":[...],\"tasks\":[...]}");
    parts.push("    Each card: {\"title\":\"<clear title>\",\"summary\":\"<what+why+how>\",\"category\":\"<cat>\"}");
    parts.push("");
    parts.push("    Engineering categories:");
    parts.push("      decision — choice between alternatives (include what was chosen AND rejected)");
    parts.push("      problem_solution — bug + root cause + fix applied");
    parts.push("      workflow — setup steps, deployment process, configuration");
    parts.push("      pitfall — gotcha, warning, limitation discovered");
    parts.push("      insight — reusable pattern or architectural learning");
    parts.push("      key_point — important technical fact");
    parts.push("    Personal categories (use when user shares preferences or personal info):");
    parts.push("      personal_preference — \"I prefer X\", \"always use Y\", communication style");
    parts.push("      important_detail — user's role, team, project context, relationships");
    parts.push("      plan_intention — user's goals, plans, upcoming deadlines");
    parts.push("      activity_preference — hobbies, interests, routines");
    parts.push("      health_info — health-related notes shared by user");
    parts.push("      career_info — job, skills, career goals");
    parts.push("      custom_misc — anything personal that doesn't fit above");
    parts.push("");
    parts.push("    Quality rules:");
    parts.push("    - Title must be descriptive (NOT 'Tool: Bash' or 'Assistant: ...')");
    parts.push("    - Summary must explain WHAT happened + WHY + key details");
    parts.push("    - Include file paths when code was changed");
    parts.push("    - Save after each MEANINGFUL milestone, not every tool call");
    parts.push("    - When user expresses preferences, save as personal_preference card");
    parts.push("  </auto-record-rule>");
    parts.push("</awareness-memory>");
    process.stdout.write(parts.join("\n"));
  } catch (err) {
    process.stderr.write(`[awareness] recall failed: ${err.message}\n`);
  }
}

main().catch(() => process.exit(0));
