#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Session Stop hook — consolidate buffered edits into a single memory record
// Called by the Stop hook after each Claude Code session
// ---------------------------------------------------------------------------

const { loadConfig, resolveEndpoint, mcpCall } = require("./shared");

const fs = require("fs");
const os = require("os");
const path = require("path");

function clearBuffer(filePath) {
  try { fs.writeFileSync(filePath, ""); } catch { /* ignore */ }
}

async function main() {
  const bufferPath = path.join(os.homedir(), ".awareness", "session-buffer.jsonl");

  // Read buffer
  let raw = "";
  try { raw = fs.readFileSync(bufferPath, "utf-8").trim(); } catch { process.exit(0); }
  if (!raw) process.exit(0);

  // Parse entries, skipping malformed lines
  const entries = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);

  if (entries.length < 2) {
    // Single edit not worth consolidating — clear and exit
    clearBuffer(bufferPath);
    process.exit(0);
  }

  // Build summary content
  const files = [...new Set(entries.map((e) => e.file))];
  const editCount = entries.filter((e) => (e.tool || "").toLowerCase() === "edit").length;
  const writeCount = entries.filter((e) => (e.tool || "").toLowerCase() === "write").length;

  const detailLines = entries
    .slice(0, 20)
    .map((e) => `  [${e.tool}] ${e.file}: ${e.brief}`);

  if (entries.length > 20) {
    detailLines.push(`  ... and ${entries.length - 20} more changes`);
  }

  const lines = [
    `Session edit summary: ${entries.length} changes across ${files.length} file(s)`,
    `- ${editCount} edits, ${writeCount} file writes`,
    `Files changed: ${files.slice(0, 10).join(", ")}${files.length > 10 ? ` (+${files.length - 10} more)` : ""}`,
    "",
    "Change details:",
    ...detailLines,
  ];

  const content = lines.join("\n");

  // Send to daemon
  let ep = null;
  try {
    const config = loadConfig();
    ep = await resolveEndpoint(config);
  } catch { /* config load failed */ }

  if (ep) {
    try {
      await mcpCall(ep.localUrl || ep.baseUrl, "awareness_record", {
        action: "remember",
        content,
        event_type: "session_summary",
      }, 10000);
    } catch (err) {
      process.stderr.write(`[awareness] session-consolidate failed: ${err.message}\n`);
    }
  }

  clearBuffer(bufferPath);
  process.exit(0);
}

main().catch(() => process.exit(0));
