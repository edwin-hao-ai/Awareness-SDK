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
  const parts = [];

  // 1. User prompt for context
  const prompt = input.prompt || input.user_message || "";
  if (prompt) parts.push(`User: ${prompt}`);

  // 2. Assistant's response (full content, no truncation)
  const response = input.response || input.result || input.message || "";
  if (response) {
    const text = typeof response === "string" ? response : JSON.stringify(response);
    parts.push(`Assistant: ${text}`);
  }

  // 3. Tool usage info if present
  if (input.tool_name) parts.push(`Tool: ${input.tool_name}`);

  return parts.length > 0 ? parts.join("\n\n") : "";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let input = {};
  try { input = await readStdin(); } catch { /* no stdin */ }

  // Debug: log what we receive
  const fs = require("fs");
  fs.appendFileSync("/tmp/capture-debug.log",
    `[${new Date().toISOString()}] keys=${Object.keys(input).join(",")}\n` +
    `  stop_reason=${input.stop_reason || input.stopReason || "none"}\n` +
    `  has_response=${!!(input.response || input.result || input.message)}\n` +
    `  has_prompt=${!!(input.prompt || input.user_message)}\n` +
    `  input_preview=${JSON.stringify(input).slice(0, 300)}\n\n`
  );

  // Only capture on meaningful completions (skip mid-conversation tool use)
  if ((input.stop_reason || input.stopReason) === "tool_use") process.exit(0);

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
        }),
        signal: AbortSignal.timeout(5000),
      });
    }
  } catch (err) {
    process.stderr.write(`[awareness] capture failed: ${err.message}\n`);
  }
}

main().catch(() => process.exit(0));
