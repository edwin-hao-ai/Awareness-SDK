#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Stop hook — Auto-capture: save session checkpoint after Claude responds
// Protocol: receives JSON on stdin, runs async (fire-and-forget)
// ---------------------------------------------------------------------------

const { loadConfig, resolveEndpoint, mcpCall, readStdin } = require("./shared");

// ---------------------------------------------------------------------------
// Extract meaningful content from Claude's response
// ---------------------------------------------------------------------------

function extractContent(input) {
  // Session checkpoint: brief summary only, NOT full response
  // The daemon's knowledge extractor skips session_checkpoint events
  const msg = input.last_assistant_message || input.response || input.result || input.message || "";
  if (!msg) return "";

  const text = typeof msg === "string" ? msg : JSON.stringify(msg);
  // Take first 200 chars as checkpoint summary
  const summary = text.slice(0, 200).replace(/\n/g, ' ').trim();
  return `Session checkpoint: ${summary}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let input = {};
  try { input = await readStdin(); } catch { /* no stdin */ }

  // Only capture on meaningful completions (skip mid-conversation tool use)
  const stopReason = input.stop_reason || input.stopReason || "";
  if (stopReason === "tool_use") process.exit(0);
  // Claude Code Stop hook sets stop_hook_active=false when not a real stop
  if (input.stop_hook_active === false && !input.last_assistant_message) process.exit(0);

  const content = extractContent(input);
  // Skip empty checkpoints — no point saving "[session-checkpoint]"
  if (!content) process.exit(0);

  const config = loadConfig();
  const ep = await resolveEndpoint(config);
  if (!ep) process.exit(0);

  try {
    if (ep.mode === "local") {
      await mcpCall(ep.localUrl, "awareness_record", {
        action: "remember",
        content,
        event_type: "session_checkpoint",
      }, 5000);
    } else {
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (ep.apiKey) headers.Authorization = `Bearer ${ep.apiKey}`;
      await fetch(`${ep.baseUrl}/mcp/events`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          memory_id: ep.memoryId,
          content,
          event_type: "session_checkpoint",
        }),
        signal: AbortSignal.timeout(5000),
      });
    }
  } catch (err) {
    process.stderr.write(`[awareness] capture failed: ${err.message}\n`);
  }
}

main().catch(() => process.exit(0));
