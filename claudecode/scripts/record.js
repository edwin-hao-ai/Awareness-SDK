#!/usr/bin/env node
// ---------------------------------------------------------------------------
// awareness_record — Save events, batch, or update tasks
// Usage:
//   Single:  node record.js "what happened and why"
//   Batch:   echo '{"steps":["step1","step2"]}' | node record.js --batch
//   Task:    node record.js --update-task task_id=xxx status=completed
//   Insight: echo '{"content":"summary","insights":{...}}' | node record.js --with-insights
// ---------------------------------------------------------------------------

const { loadConfig, resolveEndpoint, mcpCall, apiPost, apiPatch, readStdin, parseArgs } = require("./shared");
const { syncRecordToOpenClaw } = require("./sync");

async function main() {
  const args = parseArgs();
  const config = loadConfig();
  const ep = await resolveEndpoint(config);
  if (!ep) { console.log(JSON.stringify({ error: "Not configured." })); return; }

  const flags = process.argv.slice(2);

  // Mode: update task
  if (flags.includes("--update-task")) {
    if (!args.task_id || !args.status) {
      console.log(JSON.stringify({ error: "Usage: node record.js --update-task task_id=xxx status=completed" }));
      return;
    }
    if (ep.mode === "local") {
      const result = await mcpCall(ep.localUrl, "awareness_record", {
        action: "update_task",
        task_id: args.task_id,
        status: args.status,
      });
      console.log(JSON.stringify(result, null, 2));
    } else {
      const result = await apiPatch(
        ep.baseUrl, ep.apiKey,
        `/memories/${ep.memoryId}/insights/action-items/${args.task_id}`,
        { status: args.status }
      );
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  // Mode: batch
  if (flags.includes("--batch")) {
    const input = await readStdin();
    const steps = input.steps || [];
    if (steps.length === 0) { console.log(JSON.stringify({ error: "Provide {\"steps\":[...]} on stdin" })); return; }

    if (ep.mode === "local") {
      const result = await mcpCall(ep.localUrl, "awareness_record", {
        action: "remember_batch",
        items: steps,
      });
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Cloud: send each step as individual event (no /batch endpoint)
      const results = [];
      for (const step of steps) {
        const r = await apiPost(ep.baseUrl, ep.apiKey, "/mcp/events", {
          memory_id: ep.memoryId,
          content: step,
        });
        results.push(r);
      }
      console.log(JSON.stringify({ batch: true, count: results.length, results }, null, 2));
    }
    return;
  }

  // Mode: with insights
  if (flags.includes("--with-insights")) {
    const input = await readStdin();
    if (ep.mode === "local") {
      const mcpArgs = {
        action: "remember",
        content: input.content || "",
      };
      if (input.insights) mcpArgs.insights = input.insights;
      const result = await mcpCall(ep.localUrl, "awareness_record", mcpArgs);
      cachePerception(result);
      syncRecordToOpenClaw(input.content || "", input.insights, "awareness-skill");
      console.log(JSON.stringify(result, null, 2));
    } else {
      const body = {
        memory_id: ep.memoryId,
        content: input.content || "",
      };
      const result = await apiPost(ep.baseUrl, ep.apiKey, "/mcp/events", body);
      syncRecordToOpenClaw(input.content || "", input.insights, "awareness-skill");
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  // Mode: single record
  const content = args.query || flags.filter(f => !f.startsWith("--") && !f.startsWith("{")).join(" ");
  if (!content) { console.log(JSON.stringify({ error: "Usage: node record.js \"content to save\"" })); return; }

  if (ep.mode === "local") {
    const result = await mcpCall(ep.localUrl, "awareness_record", {
      action: "remember",
      content,
    });
    cachePerception(result);
    syncRecordToOpenClaw(content, undefined, "awareness-skill");
    console.log(JSON.stringify(result, null, 2));
  } else {
    const body = {
      memory_id: ep.memoryId,
      content,
    };
    const result = await apiPost(ep.baseUrl, ep.apiKey, "/mcp/events", body);
    syncRecordToOpenClaw(content, undefined, "awareness-skill");
    console.log(JSON.stringify(result, null, 2));
  }
}

/**
 * Cache perception signals from daemon response for recall.js to surface on next prompt.
 * @param {object} result — response from awareness_record MCP call
 */
function cachePerception(result) {
  const perception = result?.perception?.perception || result?.perception;
  if (!perception || !Array.isArray(perception) || perception.length === 0) return;
  try {
    const fs = require("fs");
    const path = require("path");
    const projectAwareness = path.join(path.resolve(process.env.PWD || process.cwd()), ".awareness");
    const cacheDir = fs.existsSync(projectAwareness) ? projectAwareness : path.join(process.env.HOME || "", ".awareness");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, "perception-cache.json");
    let existing = [];
    try { existing = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { /* empty */ }
    const updated = [...perception.map(s => ({ ...s, _ts: Date.now() })), ...existing].slice(0, 10);
    fs.writeFileSync(cacheFile, JSON.stringify(updated), "utf8");
  } catch { /* best-effort */ }
}

main().catch(e => { console.error(`[awareness] record failed: ${e.message}`); process.exit(1); });
