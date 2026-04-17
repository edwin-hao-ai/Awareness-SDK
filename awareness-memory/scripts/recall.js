#!/usr/bin/env node
// ⚠️ DO NOT EDIT — auto-generated from sdks/_shared/scripts/recall.js
// Edit the source in sdks/_shared/scripts/ then run:
//   bash scripts/sync-shared-scripts.sh
// See docs/features/f-036/shared-scripts-consolidation.md

// ---------------------------------------------------------------------------
// UserPromptSubmit hook — Auto-recall: search memory and inject context
// Protocol: receives JSON on stdin, outputs context text on stdout
// ---------------------------------------------------------------------------

const { loadConfig, resolveEndpoint, mcpCall, apiGet, apiPost, readStdin } = require("./shared");

// ---------------------------------------------------------------------------
// Device auth — auto-start when not configured
// ---------------------------------------------------------------------------

async function handleUnconfigured(baseUrl) {
  const fs = require("fs");
  const path = require("path");
  const HOME = process.env.HOME || process.env.USERPROFILE || "";
  const AUTH_CACHE_FILE = path.join(HOME, ".awareness", "device-auth-result.json");

  // If already approved (poll-auth wrote the cache), just notify
  if (fs.existsSync(AUTH_CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(AUTH_CACHE_FILE, "utf8"));
      if (cached.status === "approved") {
        process.stdout.write(
          "<awareness-memory>\n" +
          "  <setup-complete>Awareness Memory has been configured! Please restart this session to activate memory.</setup-complete>\n" +
          "</awareness-memory>"
        );
        return;
      }
    } catch { /* continue */ }
  }

  // Auto-start device auth
  try {
    const resp = await fetch(`${baseUrl}/auth/device/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: "awareness-skill" }),
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) { process.exit(0); return; }

    const data = await resp.json();
    const deviceCode = String(data.device_code || "");
    const userCode = String(data.user_code || "");
    const verificationUri = String(data.verification_uri || "https://awareness.market/cli-auth");
    const authUrl = `${verificationUri}?code=${encodeURIComponent(userCode)}`;
    const intervalSec = Number(data.interval || 5);
    const expiresIn = Number(data.expires_in || 900);

    if (deviceCode) {
      // Spawn poll-auth.js in background
      const { spawn } = require("child_process");
      const pollScript = path.join(__dirname, "poll-auth.js");
      if (fs.existsSync(pollScript)) {
        const child = spawn(process.execPath, [pollScript, deviceCode, baseUrl, String(intervalSec), String(expiresIn)], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      }

      // Detect headless environment (SSH, Docker, Codespaces, no-TTY)
      // and tailor the setup-required message accordingly. The Claude CLI
      // surfaces this text verbatim to the model, which then shows the
      // user — so it must work in any host.
      let headless = false;
      try {
        const h = require("./headless-auth.js");
        headless = h.isHeadlessEnv();
      } catch { /* helper missing — assume desktop */ }

      const setupLine = headless
        ? `On any device with a browser, open ${authUrl} and enter code ${userCode}.`
        : `To enable persistent memory, visit this link and sign in (~30 seconds): ${authUrl}`;

      process.stdout.write(
        "<awareness-memory>\n" +
        "  <setup-required>\n" +
        `    ${setupLine}\n` +
        `    Once done, start a new session and memory will activate automatically.\n` +
        "  </setup-required>\n" +
        "</awareness-memory>"
      );
    }
  } catch { /* network error — silent exit */ }
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
  if (!ep) {
    // Not configured — auto-start device auth and inject login URL into context
    await handleUnconfigured(config.baseUrl || "https://awareness.market/api/v1");
    return;
  }

  try {
    let ctx, recall;

    // Import shared keyword extractor (ESM dynamic import from CJS)
    const { extractKeywords } = await import("./harness-builder.mjs");
    const keywords = extractKeywords(prompt).join(" ");

    if (ep.mode === "local") {
      // Local daemon + optional cloud: parallel calls
      const promises = [
        mcpCall(ep.localUrl, "awareness_init", { source: "awareness-skill", query: prompt }, 6000),
        // F-053 Phase 2: single-parameter entry point — daemon auto-routes
        // across memories + knowledge cards + workspace graph and picks the
        // right detail level based on token budget.
        mcpCall(ep.localUrl, "awareness_recall", {
          query: prompt,
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

    // -----------------------------------------------------------------------
    // Read perception cache (client-side only — server doesn't have this)
    // -----------------------------------------------------------------------
    let perceptionSignals = [];
    try {
      const _projAw = require("path").join(require("path").resolve(process.env.PWD || process.cwd()), ".awareness");
      const _cacheBase = require("fs").existsSync(_projAw) ? _projAw : require("path").join(process.env.HOME || "", ".awareness");
      const perceptionCacheFile = require("path").join(_cacheBase, "perception-cache.json");
      if (require("fs").existsSync(perceptionCacheFile)) {
        const cached = JSON.parse(require("fs").readFileSync(perceptionCacheFile, "utf8"));
        const cutoff = Date.now() - 30 * 60 * 1000;
        perceptionSignals = (cached || []).filter(s => (s._ts || 0) > cutoff);
        if (perceptionSignals.length > 0) {
          // Clear consumed signals
          require("fs").writeFileSync(perceptionCacheFile, "[]", "utf8");
        }
      }
    } catch { /* best-effort */ }

    // -----------------------------------------------------------------------
    // Resolve save-memory.js script path (CC-specific record-rule)
    // -----------------------------------------------------------------------
    const scriptPaths = [
      process.env.CLAUDE_PLUGIN_ROOT && `${process.env.CLAUDE_PLUGIN_ROOT}/scripts/save-memory.js`,
      `${process.env.HOME}/.claude/plugins/cache/awareness/awareness-memory/0.1.0/scripts/save-memory.js`,
      `${__dirname}/save-memory.js`,
    ].filter(Boolean);
    const fs = require("fs");
    const resolvedScript = scriptPaths.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || scriptPaths[1];

    // -----------------------------------------------------------------------
    // Build XML: prefer server-rendered context, fallback to shared builder
    // -----------------------------------------------------------------------
    let xmlOutput;

    if (ctx && ctx.rendered_context) {
      // Server provided pre-rendered XML — use it as base, append CC-specific sections
      const { escapeXml } = await import("./harness-builder.mjs");
      const esc = escapeXml;

      // Strip closing tag so we can append CC-specific sections
      let base = ctx.rendered_context.replace(/<\/awareness-memory>\s*$/, "");

      // Append perception signals (client-side cache, not available to server)
      if (perceptionSignals.length > 0) {
        const pParts = [];
        pParts.push("  <perception>");
        pParts.push("    <action-required>BEFORE responding to the user, you MUST address each signal below. "
          + "For contradictions: inform the user and ask if intentional. "
          + "For resonance: mention the related past experience. "
          + "For patterns: suggest a systematic fix. "
          + "For staleness: warn knowledge may be outdated. "
          + "For guards: STOP and warn about the known pitfall. "
          + "For crystallization: synthesize the similar cards into a skill and submit via awareness_record(insights={skills:[{name,summary,methods,trigger_conditions,tags,source_card_ids}]}).</action-required>");
        for (const s of perceptionSignals.slice(0, 5)) {
          pParts.push(`    <signal type="${esc(s.type || "")}">${esc(s.message || "")}</signal>`);
        }
        pParts.push("  </perception>");
        base += "\n" + pParts.join("\n");
      }

      // Append record-rule — salience-aware, philosophy synced with
      // sdks/_shared/prompts/extraction-salience.md
      base += "\n  <record-rule>";
      base += `\n    Save significant work SILENTLY: node "${resolvedScript}" '<JSON>'`;
      base += '\n    JSON: {"content":"what+why in detail","cards":[{"title":"...","summary":"400-800 char wiki entry with Markdown","category":"decision|problem_solution|workflow|pitfall|insight|key_point|personal_preference|important_detail","novelty_score":0.0,"durability_score":0.0,"specificity_score":0.0}]}';
      base += "\n    PHILOSOPHY: distilled essence, not raw logs. Your job is NOT 'save every turn' — it is 'identify what's worth recalling in 6 months on a fresh project'. An empty cards array is a first-class answer.";
      base += "\n    EXTRACT when: decision made with reason; non-obvious bug fixed (symptom+root_cause+fix+avoidance); workflow/convention established; user stated preference/constraint; pitfall+workaround found; important new fact about user/project.";
      base += "\n    DO NOT EXTRACT: agent framework metadata (Sender (untrusted metadata), turn_brief, [Operational context metadata ...], [Subagent Context] — even when wrapped in Request:/Result:/Send: envelopes); greetings; command invocations; 'what can you do' turns; code restatement (git has it); test/debug sessions verifying the AI tool works; transient status/progress.";
      base += "\n    Single question: 'If I start a fresh project 6 months from now, will being reminded of this help me?' If no → empty cards.";
      base += "\n    EACH CARD MUST SCORE 0.0-1.0: novelty_score (new vs known), durability_score (matters in 6 months?), specificity_score (concrete paths/commands vs vague). Cards with novelty<0.4 OR durability<0.4 will be discarded. Score honestly.";
      base += "\n    Summary quality: mini wiki entry, natural Markdown per category. GOOD: 'Chose pgvector over Pinecone. Saves $70/mo, co-locates with relational data, cosine <=>. Trade-off: lower QPS >10M.' BAD: 'Use pgvector instead of Pinecone.'";
      base += "\n    Do NOT gate on length — a 15-char preference can be more valuable than a 5000-char log.";
      base += "\n    Categories: [Tech] decision|problem_solution|workflow|pitfall|insight|key_point";
      base += "\n    [Personal] personal_preference|important_detail|plan_intention|activity_preference|health_info|career_info|custom_misc";
      base += "\n  </record-rule>";
      base += "\n</awareness-memory>";

      xmlOutput = base;
    } else {
      // No rendered_context — build XML client-side via shared harness builder
      const { buildContextXml, parseRecallResults } = await import("./harness-builder.mjs");

      // Parse recall results for the builder
      const recallResults = parseRecallResults(recall);

      // Determine dashboard URL for local mode welcome
      let localUrl = null;
      if (ep.mode === "local") {
        const welcomeFile = require("path").join(process.env.HOME || "", ".awareness", "dashboard-welcomed");
        if (!require("fs").existsSync(welcomeFile)) {
          localUrl = ep.localUrl.replace(/\/api\/v1\/?$/, "");
          try { require("fs").writeFileSync(welcomeFile, "1", "utf8"); } catch { /* best-effort */ }
        }
      }

      xmlOutput = buildContextXml(ctx, recallResults, perceptionSignals, {
        currentFocus: prompt,
        localUrl,
        recordRuleScript: resolvedScript,
      });
    }

    process.stdout.write(xmlOutput);

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
