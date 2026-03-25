#!/usr/bin/env node
/**
 * ensure-mcp.js — Safely add awareness-memory to project .mcp.json
 * - Creates .mcp.json if missing
 * - Merges into existing file without overwriting other servers
 * - Skips if awareness-memory already configured
 */

const fs = require('fs');
const path = require('path');

const MCP_SERVER_KEY = 'awareness-memory';
const MCP_CONFIG = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@awareness-sdk/local', 'mcp'],
};

function ensureMcpConfig(projectDir) {
  const mcpPath = path.join(projectDir, '.mcp.json');

  let existing = { mcpServers: {} };
  try {
    if (fs.existsSync(mcpPath)) {
      existing = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      if (!existing.mcpServers) existing.mcpServers = {};
    }
  } catch {
    // Invalid JSON — start fresh but preserve file
    existing = { mcpServers: {} };
  }

  // Skip if already configured
  if (existing.mcpServers[MCP_SERVER_KEY]) {
    return 'exists';
  }

  // Add our server
  existing.mcpServers[MCP_SERVER_KEY] = MCP_CONFIG;

  fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2) + '\n');
  return 'added';
}

// Run if called directly
const projectDir = process.env.PWD || process.cwd();
const result = ensureMcpConfig(projectDir);
if (result === 'added') {
  process.stderr.write(`[awareness] Added awareness-memory to .mcp.json\n`);
}
