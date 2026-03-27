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
      // Local daemon + optional cloud: parallel calls
      const promises = [
        mcpCall(ep.localUrl, "awareness_init", { source: "awareness-skill", query: prompt }, 6000),
        mcpCall(ep.localUrl, "awareness_recall", {
          semantic_query: prompt,
          keyword_query: keywords || undefined,
          detail: "summary",
          limit: config.recallLimit,
        }, 6000),
      ];

      // If cloud credentials available, add cloud search in parallel (3s timeout)
      let cloudRecall = null;
      if (ep.apiKey && ep.memoryId && ep.memoryId !== "local") {
        promises.push(
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
            detail: "summary",
          }).catch(() => null)  // silent fail — cloud is optional
        );
      }

      const results = await Promise.all(promises);
      ctx = results[0];
      recall = results[1];
      cloudRecall = results[2] || null;

      // Merge cloud results into recall (cloud supplements local)
      if (cloudRecall && cloudRecall.results) {
        const localIds = new Set();
        if (typeof recall === "string") {
          // Will be parsed later
        } else if (recall && recall.results) {
          recall.results.forEach(r => { if (r.id) localIds.add(r.id); });
        }
        // Append cloud-only results
        const cloudOnly = cloudRecall.results.filter(r => !localIds.has(r.id));
        if (cloudOnly.length > 0) {
          if (typeof recall === "object" && recall && recall.results) {
            recall.results = [...recall.results, ...cloudOnly.slice(0, 3)];
          } else {
            recall = { results: cloudOnly.slice(0, 5) };
          }
        }
      }
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

    const sessions = (ctx.last_sessions || ctx.recent_sessions || [])
      .filter(s => (s.event_count || s.memory_count || 0) > 0 || s.summary)
      .slice(0, 5);
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

    // Who-you-are: surface personal knowledge cards as user profile
    // Daemon splits personal cards into user_preferences, so check both sources
    const personalCategories = new Set(['personal_preference','important_detail','career_info','activity_preference','plan_intention']);
    const personalCards = [
      ...(ctx.user_preferences || []),
      ...(ctx.knowledge_cards || []).filter(c => personalCategories.has(c.category)),
    ];
    if (personalCards.length > 0) {
      parts.push("  <who-you-are>");
      for (const c of personalCards.slice(0, 3)) {
        parts.push(`    ${esc(c.title)}: ${esc(c.summary)}`);
      }
      parts.push("  </who-you-are>");
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
        // MCP text response — try to parse JSON, fallback to raw text
        try {
          const parsed = JSON.parse(recall);
          results = (parsed.results || parsed.items || []).filter(r => !r.score || r.score >= 0.3);
        } catch {
          // If it's plain text, create a single result from it
          if (recall.trim().length > 20) {
            results = [{ content: recall.trim(), score: 0.5 }];
          }
        }
      } else {
        results = (recall.results || []).filter((r) => !r.score || r.score >= 0.5);
      }
    }
    if (results.length > 0) {
      parts.push("  <recall>");
      for (const r of results) {
        if (r.content) {
          const score = r.score ? r.score : 0;
          const daysAgo = r.created_at ? Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000) : 0;
          const isAha = score > 0.8 && daysAgo > 3;

          if (isAha) {
            parts.push(`    <aha score="${score.toFixed(2)}" days-ago="${daysAgo}">`);
            parts.push(`      ${r.content.slice(0, 300)}`);
            parts.push("    </aha>");
          } else {
            const scoreAttr = score ? ` score="${score.toFixed(2)}"` : "";
            parts.push(`    <result${scoreAttr}>${esc(r.content.slice(0, 200))}</result>`);
          }
        }
      }
      parts.push("  </recall>");
    }

    // Perception: surface signals from recent records (Eywa Whisper)
    // These are things the system noticed during previous saves that the agent didn't ask about.
    try {
      const perceptionCacheFile = require("path").join(process.env.HOME || "", ".awareness", "perception-cache.json");
      if (require("fs").existsSync(perceptionCacheFile)) {
        const cached = JSON.parse(require("fs").readFileSync(perceptionCacheFile, "utf8"));
        // Only show signals from last 30 minutes
        const cutoff = Date.now() - 30 * 60 * 1000;
        const recent = (cached || []).filter(s => (s._ts || 0) > cutoff);
        if (recent.length > 0) {
          parts.push("  <perception>");
          parts.push("    <action-required>BEFORE responding to the user, you MUST address each signal below. For contradiction: tell user about the conflict and ask if intentional. For resonance: mention the past experience. For pattern: suggest systematic fix. For staleness: warn knowledge may be outdated. For related_decision: mention prior decision.</action-required>");
          for (const s of recent.slice(0, 5)) {
            parts.push(`    <signal type="${esc(s.type)}">${esc(s.message)}</signal>`);
          }
          parts.push("  </perception>");
          // Clear consumed signals
          require("fs").writeFileSync(perceptionCacheFile, "[]", "utf8");
        }
      }
    } catch { /* best-effort */ }

    // Inject compact auto-record instructions (~100 tokens instead of ~300)
    parts.push("  <record-rule>");
    // Resolve the actual script path: prefer CLAUDE_PLUGIN_ROOT, fallback to cache path, finally repo path
    const scriptPaths = [
      process.env.CLAUDE_PLUGIN_ROOT && `${process.env.CLAUDE_PLUGIN_ROOT}/scripts/save-memory.js`,
      `${process.env.HOME}/.claude/plugins/cache/awareness/awareness-memory/0.1.0/scripts/save-memory.js`,
      `${__dirname}/save-memory.js`,
    ].filter(Boolean);
    const fs = require("fs");
    const resolvedScript = scriptPaths.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || scriptPaths[1];
    parts.push(`    Save significant work SILENTLY: node "${resolvedScript}" '<JSON>'`);
    parts.push("    JSON: {\"content\":\"what+why\",\"cards\":[{\"title\":\"...\",\"summary\":\"...\",\"category\":\"decision|problem_solution|workflow|pitfall|insight|key_point|personal_preference|important_detail\"}]}");
    parts.push("    Save decisions, solutions, pitfalls, user preferences. NOT every tool call.");
    parts.push("  </record-rule>");
    parts.push("</awareness-memory>");
    process.stdout.write(parts.join("\n"));

    // Fire-and-forget: import OpenClaw history on first run (idempotent via marker file)
    try {
      const { resolveWorkspace } = require("./sync");
      const workspace = resolveWorkspace();
      if (workspace) {
        const markerFile = require("path").join(workspace, ".awareness-openclaw-imported");
        if (!require("fs").existsSync(markerFile)) {
          const { spawn } = require("child_process");
          spawn(process.execPath, [require("path").join(__dirname, "import.js")], {
            detached: true,
            stdio: "ignore",
          }).unref();
        }
      }
    } catch { /* best-effort */ }
  } catch (err) {
    process.stderr.write(`[awareness] recall failed: ${err.message}\n`);
  }
}

main().catch(() => process.exit(0));
