#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PostToolUse hook — Buffer Edit/Write changes to session-buffer.jsonl
// No debounce: every change is captured. Session Stop hook consolidates.
// ---------------------------------------------------------------------------

const { readStdin } = require("./shared");

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

  const fs = require("fs");
  const os = require("os");
  const path = require("path");

  // Parse tool input safely
  const toolInput = input.tool_input || input.input || {};
  let inputObj = {};
  if (typeof toolInput === "string") {
    try { inputObj = JSON.parse(toolInput); } catch { inputObj = {}; }
  } else if (toolInput && typeof toolInput === "object") {
    inputObj = toolInput;
  }

  const filePath = inputObj.file_path || inputObj.path || "unknown";

  // Build a brief description of the change
  let brief = "";
  if (toolName.toLowerCase() === "edit") {
    const old = String(inputObj.old_string || "").slice(0, 80);
    const next = String(inputObj.new_string || "").slice(0, 80);
    brief = `${old} → ${next}`;
  } else {
    const lines = String(inputObj.content || "").split("\n").length;
    brief = `wrote ${lines} lines`;
  }

  const entry = JSON.stringify({
    ts: Date.now(),
    tool: toolName,
    file: filePath,
    brief,
  });

  // Append to session buffer — never fail
  try {
    const bufferDir = path.join(os.homedir(), ".awareness");
    if (!fs.existsSync(bufferDir)) fs.mkdirSync(bufferDir, { recursive: true });
    fs.appendFileSync(path.join(bufferDir, "session-buffer.jsonl"), entry + "\n");
  } catch { /* never crash the hook */ }

  process.exit(0);
}

main().catch(() => process.exit(0));
