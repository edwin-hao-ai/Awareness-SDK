#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PostToolUse hook — Only record Edit/Write (actual code changes)
// Bash commands are too noisy and create low-quality memories
// ---------------------------------------------------------------------------

const { loadConfig, resolveEndpoint, mcpCall, readStdin } = require("./shared");

// Only track actual file modifications, not command execution
const CODE_CHANGE_TOOLS = new Set([
  "edit", "write", "notebookedit",
  "Edit", "Write", "NotebookEdit",
]);

async function main() {
  let input = {};
  try { input = await readStdin(); } catch { /* no stdin */ }

  const toolName = input.tool_name || input.toolName || "";
  if (!toolName || !CODE_CHANGE_TOOLS.has(toolName)) process.exit(0);

  // Debounce: don't save more than once per 60 seconds
  const fs = require("fs");
  const os = require("os");
  const debounceFile = require("path").join(os.homedir(), ".awareness", "post-tool-ts");
  try {
    const last = Number(fs.readFileSync(debounceFile, "utf-8").trim());
    if (Date.now() - last < 60000) process.exit(0);
  } catch { /* no file or parse error */ }
  try { fs.writeFileSync(debounceFile, String(Date.now())); } catch { /* ignore */ }

  const config = loadConfig();
  const ep = await resolveEndpoint(config);
  if (!ep) process.exit(0);

  try {
    // Extract file path from tool input
    const toolInput = input.tool_input || input.input || {};
    const inputObj = typeof toolInput === "string" ? (() => { try { return JSON.parse(toolInput); } catch { return {}; } })() : toolInput;
    const filePath = inputObj.file_path || inputObj.path || "";

    // Build concise description
    const parts = [`File changed: ${filePath || "unknown"}`];

    // For Edit, include old→new context
    if (toolName.toLowerCase() === "edit" && inputObj.old_string && inputObj.new_string) {
      parts.push(`Changed: "${inputObj.old_string.slice(0, 100)}" → "${inputObj.new_string.slice(0, 100)}"`);
    }

    const content = parts.join("\n");

    if (ep.mode === "local") {
      await mcpCall(ep.localUrl, "awareness_record", {
        action: "remember",
        content,
        event_type: "code_change",
      }, 5000);
    }
  } catch (err) {
    process.stderr.write(`[awareness] post-tool capture failed: ${err.message}\n`);
  }
}

main().catch(() => process.exit(0));
