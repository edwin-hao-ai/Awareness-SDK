#!/usr/bin/env node
// ---------------------------------------------------------------------------
// save-memory.js — Simple wrapper for Claude to save memories via Bash
// Usage: node save-memory.js '{"content":"what happened","cards":[{"title":"...","summary":"...","category":"decision"}]}'
// ---------------------------------------------------------------------------

const { loadConfig, resolveEndpoint, mcpCall } = require("./shared");

async function main() {
  const arg = process.argv[2];
  if (!arg) { process.stderr.write("Usage: node save-memory.js '{json}'\n"); process.exit(1); }

  let data;
  try { data = JSON.parse(arg); } catch (e) {
    process.stderr.write(`[awareness] JSON parse error: ${e.message}\n`);
    process.exit(1);
  }

  const config = loadConfig();
  const ep = await resolveEndpoint(config);
  if (!ep) { process.stderr.write("[awareness] daemon not available\n"); process.exit(1); }

  const insights = {};
  if (data.cards && data.cards.length > 0) {
    insights.knowledge_cards = data.cards.map(c => ({
      title: c.title || "",
      summary: c.summary || "",
      category: c.category || "key_point",
      confidence: c.confidence || 0.85,
    }));
  }
  if (data.tasks && data.tasks.length > 0) {
    insights.action_items = data.tasks.map(t => ({
      title: t.title || "",
      description: t.description || "",
      priority: t.priority || "medium",
    }));
  }

  try {
    const result = await mcpCall(ep.localUrl, "awareness_record", {
      action: "remember",
      content: data.content || "",
      insights: Object.keys(insights).length > 0 ? insights : undefined,
    }, 8000);
    process.stdout.write(JSON.stringify({ status: "saved", id: result.id }) + "\n");
  } catch (err) {
    process.stderr.write(`[awareness] save failed: ${err.message}\n`);
    process.exit(1);
  }
}

main().catch(() => process.exit(1));
