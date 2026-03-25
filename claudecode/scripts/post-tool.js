#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PostToolUse hook — Auto-record after significant tool operations
// Only fires for Edit, Write, Bash (code changes) — skips Read/Glob/Grep
// ---------------------------------------------------------------------------

const { loadConfig, resolveEndpoint, mcpCall, readStdin } = require("./shared");

const SIGNIFICANT_TOOLS = new Set([
  "edit", "write", "bash", "notebookedit",
  "Edit", "Write", "Bash", "NotebookEdit",
]);

async function main() {
  let input = {};
  try { input = await readStdin(); } catch { /* no stdin */ }

  const toolName = input.tool_name || input.toolName || "";
  if (!toolName || !SIGNIFICANT_TOOLS.has(toolName)) process.exit(0);

  // Debounce: don't save more than once per 30 seconds
  const fs = require("fs");
  const debounceFile = "/tmp/awareness-post-tool-ts";
  try {
    const last = Number(fs.readFileSync(debounceFile, "utf-8").trim());
    if (Date.now() - last < 30000) process.exit(0);
  } catch { /* no file or parse error */ }
  try { fs.writeFileSync(debounceFile, String(Date.now())); } catch { /* ignore */ }

  const config = loadConfig();
  const ep = await resolveEndpoint(config);
  if (!ep) process.exit(0);

  try {
    // Build content from tool input/output
    const parts = [];
    parts.push(`Tool: ${toolName}`);

    const toolInput = input.tool_input || input.input || "";
    if (toolInput) {
      const inputStr = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput);
      parts.push(`Input: ${inputStr.slice(0, 500)}`);
    }

    const toolOutput = input.tool_output || input.output || input.result || "";
    if (toolOutput) {
      const outputStr = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput);
      parts.push(`Output: ${outputStr.slice(0, 500)}`);
    }

    const content = parts.join("\n");

    if (ep.mode === "local") {
      await mcpCall(ep.localUrl, "awareness_record", {
        action: "remember",
        content,
        event_type: "tool_use",
      }, 5000);
    }
  } catch (err) {
    process.stderr.write(`[awareness] post-tool capture failed: ${err.message}\n`);
  }
}

main().catch(() => process.exit(0));
