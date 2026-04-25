#!/usr/bin/env node

/**
 * @awareness-sdk/setup - Sync Awareness Memory workflow rules into IDE config files.
 */

import readline from "node:readline";
import http from "node:http";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  autoDetectAllIdes,
  autoDetectIde,
  buildMcpSnippet,
  getIdeConfig,
  getIdeMcpGlobalPath,
  getIdeMcpPath,
  getSupportedIdeIds,
  loadRulesSpec,
  normalizeIdeId,
  syncIdeMcpConfig,
  syncIdeMcpGlobalConfig,
  syncIdeMcpTomlConfig,
  syncIdeRules,
  syncOpenClawConfig,
} from "./rules.mjs";

import {
  clearCredentials,
  formatTokenSavings,
  getTokenSavings,
  loadCredentials,
  runAuthFlow,
  runMemoryFlow,
} from "./auth.mjs";

// ---------------------------------------------------------------------------
// Local daemon helpers (zero dependencies — uses built-in http module)
// ---------------------------------------------------------------------------

const LOCAL_DAEMON_PORT = 37800;
const LOCAL_DAEMON_URL = `http://localhost:${LOCAL_DAEMON_PORT}`;
const LOCAL_MCP_URL = `${LOCAL_DAEMON_URL}/mcp`;
const LOCAL_HEALTHZ_URL = `${LOCAL_DAEMON_URL}/healthz`;

/**
 * Check if the local Awareness daemon is running by hitting /healthz.
 * Returns true if healthy, false otherwise. Timeout: 2 seconds.
 */
function checkDaemonHealth() {
  return new Promise((resolve) => {
    const req = http.get(LOCAL_HEALTHZ_URL, { timeout: 2000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => { resolve(res.statusCode >= 200 && res.statusCode < 300); });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

/**
 * Attempt to start the local daemon via `npx @awareness-sdk/local start`.
 * Returns true if spawn succeeded (does NOT wait for readiness).
 */
async function tryStartDaemon(embeddingLang = "en") {
  try {
    const { spawn } = await import("node:child_process");
    const { existsSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const env = { ...process.env };
    if (embeddingLang === "multi") {
      env.AWARENESS_EMBEDDING_LANG = "multi";
    }

    // Try local sibling package first (development), then npx (production)
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const localBin = resolve(thisDir, "../../local/bin/awareness-local.mjs");

    if (existsSync(localBin)) {
      // Development: use local sibling package directly
      const child = spawn("node", [localBin, "start"], {
        detached: true,
        stdio: "ignore",
        env,
      });
      child.unref();
    } else {
      // Production: use npx (package published to npm)
      const child = spawn("npx", ["@awareness-sdk/local", "start"], {
        detached: true,
        stdio: "ignore",
        env,
      });
      child.unref();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll /healthz until the daemon is ready, up to `maxWaitMs`.
 * Returns true if daemon became ready, false if timed out.
 */
async function waitForDaemon(maxWaitMs = 10000) {
  const start = Date.now();
  const interval = 500;
  while (Date.now() - start < maxWaitMs) {
    if (await checkDaemonHealth()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

function createQuestionPrompt(input = process.stdin, output = process.stdout) {
  return (question) => new Promise((resolve) => {
    const rl = readline.createInterface({ input, output });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function resolveMcpConfigInputs(options = {}) {
  const {
    argv = [],
    ideId = "",
    env = process.env,
    prompt = null,
    isInteractive = Boolean(process.stdin?.isTTY && process.stdout?.isTTY),
  } = options;

  const readArg = (name, envKey = "") => {
    const index = argv.indexOf(name);
    if (index !== -1 && argv[index + 1]) {
      return argv[index + 1];
    }
    return envKey ? env[envKey] ?? "" : "";
  };

  const configureMcp = argv.includes("--configure-mcp");
  let mcpUrl = readArg("--mcp-url", "AWARENESS_MCP_URL");
  let apiKey = readArg("--api-key", "AWARENESS_API_KEY");
  let memoryId = readArg("--memory-id", "AWARENESS_MEMORY_ID");
  let agentRole = readArg("--agent-role", "AWARENESS_AGENT_ROLE") || "builder_agent";
  let serverName = readArg("--server-name", "AWARENESS_MCP_SERVER_NAME") || "awareness-memory";

  const wantsMcpConfig = configureMcp || Boolean(mcpUrl || apiKey || memoryId);
  if (!wantsMcpConfig) {
    return {
      shouldSync: false,
      mcpUrl,
      apiKey,
      memoryId,
      agentRole,
      serverName,
    };
  }

  const mcpPath = getIdeMcpPath(ideId);
  if (!mcpPath) {
    return {
      shouldSync: true,
      unsupported: true,
      mcpUrl,
      apiKey,
      memoryId,
      agentRole,
      serverName,
    };
  }

  const ask = prompt ?? (isInteractive ? createQuestionPrompt() : null);
  if (ask) {
    if (!mcpUrl) {
      mcpUrl = String(await ask("Awareness MCP URL: ")).trim();
    }
    if (!apiKey) {
      apiKey = String(await ask("Awareness API key: ")).trim();
    }
    if (!memoryId) {
      memoryId = String(await ask("Awareness Memory ID: ")).trim();
    }
    if (!agentRole) {
      agentRole = String(await ask("Agent role [builder_agent]: ")).trim() || "builder_agent";
    }
    if (!serverName) {
      serverName = String(await ask("MCP server name [awareness-memory]: ")).trim() || "awareness-memory";
    }
  }

  return {
    shouldSync: true,
    mcpUrl,
    apiKey,
    memoryId,
    agentRole,
    serverName,
  };
}

// ---------------------------------------------------------------------------
// Doctor command — cross-channel health check
// ---------------------------------------------------------------------------

async function doctorCommand() {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const home = os.default.homedir();
  let issues = 0;

  console.log("\n  Awareness Doctor\n");

  // 1. Local daemon
  const daemonHealthy = await checkDaemonHealth();
  if (daemonHealthy) {
    // Get stats from healthz
    try {
      const data = await new Promise((resolve) => {
        http.get(LOCAL_HEALTHZ_URL, { timeout: 2000 }, (res) => {
          let d = ""; res.on("data", (c) => { d += c; }); res.on("end", () => resolve(d));
        }).on("error", () => resolve(""));
      });
      const stats = JSON.parse(data);
      console.log(`  [OK] Local daemon running (port ${stats.port || LOCAL_DAEMON_PORT}, pid ${stats.pid || "?"})`);
      console.log(`       ${stats.stats?.totalMemories || 0} memories, ${stats.stats?.totalKnowledge || 0} knowledge cards`);
    } catch {
      console.log(`  [OK] Local daemon running on port ${LOCAL_DAEMON_PORT}`);
    }
  } else {
    console.log(`  [!!] Local daemon NOT running (port ${LOCAL_DAEMON_PORT})`);
    console.log(`       Fix: npx @awareness-sdk/local start`);
    issues++;
  }

  // 2. Cloud credentials
  const creds = loadCredentials();
  if (creds?.api_key) {
    console.log(`  [OK] Cloud credentials found (key: ${creds.api_key.slice(0, 8)}...)`);
    if (creds.memory_id) {
      console.log(`       Memory ID: ${creds.memory_id}`);
    }
  } else {
    console.log(`  [--] No cloud credentials (local-only mode)`);
  }

  // 3. IDE detection + rules
  const detected = autoDetectAllIdes();
  if (detected.length > 0) {
    console.log(`  [OK] IDEs detected: ${detected.join(", ")}`);
    for (const ideId of detected) {
      const config = getIdeConfig(ideId);
      if (!config || !config.rules_file) continue;
      const rulesPath = path.default.join(process.cwd(), config.rules_file);
      const rulesExist = fs.default.existsSync(rulesPath);
      // Check if rules contain awareness markers
      let hasMarker = false;
      if (rulesExist) {
        try {
          const content = fs.default.readFileSync(rulesPath, "utf-8");
          hasMarker = content.includes("AWARENESS") || content.includes("awareness_init");
        } catch { /* ignore */ }
      }
      if (rulesExist && hasMarker) {
        console.log(`       [OK] ${config.rules_file} (awareness rules injected)`);
        // Check rules_version against spec.version
        try {
          const rulesContent = fs.default.readFileSync(rulesPath, "utf-8");
          const versionMatch = rulesContent.match(/rules_version\s*[=:]\s*["']?(\d+)/);
          const localVersion = versionMatch ? parseInt(versionMatch[1], 10) : 0;
          const spec = loadRulesSpec();
          const latestVersion = spec.version || 0;
          if (localVersion < latestVersion) {
            console.log(`       [\u26A0\uFE0F] Rules outdated (v${localVersion} \u2192 v${latestVersion}). Run: npx @awareness-sdk/setup rules --sync`);
            issues++;
          }
        } catch { /* ignore version check errors */ }
      } else if (rulesExist) {
        console.log(`       [!!] ${config.rules_file} exists but NO awareness rules`);
        console.log(`            Fix: npx @awareness-sdk/setup --ide ${ideId}`);
        issues++;
      } else {
        console.log(`       [!!] ${config.rules_file} missing`);
        console.log(`            Fix: npx @awareness-sdk/setup --ide ${ideId}`);
        issues++;
      }

      // Check MCP config (skip for IDEs without MCP file, e.g. OpenClaw)
      let mcpPath = null;
      try { mcpPath = getIdeMcpPath(ideId); } catch { /* no MCP path */ }
      if (mcpPath) {
        const fullMcpPath = path.default.join(process.cwd(), mcpPath);
        const mcpExists = fs.default.existsSync(fullMcpPath);
        let hasMcp = false;
        if (mcpExists) {
          try {
            const content = fs.default.readFileSync(fullMcpPath, "utf-8");
            hasMcp = content.includes("awareness");
          } catch { /* ignore */ }
        }
        if (mcpExists && hasMcp) {
          console.log(`       [OK] ${mcpPath} (MCP configured)`);
        } else if (!mcpExists || !hasMcp) {
          console.log(`       [!!] ${mcpPath} — no awareness MCP config`);
          issues++;
        }
      }
    }
  } else {
    console.log(`  [--] No IDE detected in current directory`);
  }

  // 4. OpenClaw plugin
  try {
    const { execSync } = await import("node:child_process");
    const output = execSync("openclaw plugins inspect openclaw-memory 2>&1", { encoding: "utf-8", timeout: 10000 });
    const versionMatch = output.match(/Version:\s*(\S+)/);
    const statusMatch = output.match(/Status:\s*(\S+)/);
    if (statusMatch?.[1] === "loaded") {
      console.log(`  [OK] OpenClaw plugin: v${versionMatch?.[1] || "?"} (loaded)`);
    } else {
      console.log(`  [!!] OpenClaw plugin: ${statusMatch?.[1] || "not found"}`);
      issues++;
    }
  } catch {
    console.log(`  [--] OpenClaw CLI not found (skip)`);
  }

  // 5. Claude Code plugin
  const claudePluginDir = path.default.join(home, ".claude", "plugins", "awareness-memory");
  if (fs.default.existsSync(claudePluginDir)) {
    const settingsPath = path.default.join(claudePluginDir, "settings.json");
    if (fs.default.existsSync(settingsPath)) {
      console.log(`  [OK] Claude Code plugin installed`);
    } else {
      console.log(`  [!!] Claude Code plugin dir exists but settings.json missing`);
      issues++;
    }
  } else {
    console.log(`  [--] Claude Code plugin not installed (skip)`);
  }

  // 6. Data directory
  const awarenessDir = path.default.join(home, ".awareness");
  if (fs.default.existsSync(awarenessDir)) {
    const memCount = fs.default.existsSync(path.default.join(awarenessDir, "memories"))
      ? (fs.default.readdirSync(path.default.join(awarenessDir, "memories")).length)
      : 0;
    const indexExists = fs.default.existsSync(path.default.join(awarenessDir, "index.db"));
    console.log(`  [OK] Data directory: ~/.awareness/ (${memCount} memory files, index: ${indexExists ? "yes" : "no"})`);
  } else {
    console.log(`  [--] No data directory (~/.awareness/ not found)`);
  }

  // Summary
  console.log("");
  if (issues === 0) {
    console.log("  All checks passed.\n");
  } else {
    console.log(`  ${issues} issue(s) found. Run suggested fix commands above.\n`);
  }

  return issues > 0 ? 1 : 0;
}

export function printUsage() {
  console.log(`
@awareness-sdk/setup - Set up Awareness Memory for your IDE

Usage:
  npx @awareness-sdk/setup                 Local mode (default): start daemon + sync rules + MCP
  npx @awareness-sdk/setup --cloud         Cloud mode: login, select memory, sync rules + MCP
  npx @awareness-sdk/setup --ide cursor    Force specific IDE
  npx @awareness-sdk/setup --no-auth       Skip login (rules only, no MCP config)
  npx @awareness-sdk/setup --configure-mcp Prompt for MCP config values manually
  npx @awareness-sdk/setup --mcp-url <url> --api-key <key> --memory-id <id>
                                           Provide MCP config values directly (skip auth / cloud mode)
  npx @awareness-sdk/setup --dry-run       Preview without writing
  npx @awareness-sdk/setup --force         Allow overwrite for managed files without markers
  npx @awareness-sdk/setup --list          Show supported IDEs
  npx @awareness-sdk/setup --logout        Clear saved credentials
  npx @awareness-sdk/setup doctor          Run diagnostic checks on all channels
  npx @awareness-sdk/setup --api-base <url> Use custom API base URL

Modes:
  Default (local):  Runs a local Awareness daemon on port ${LOCAL_DAEMON_PORT}.
                    Your data stays on your machine. No account needed.
  --cloud:          Uses Awareness cloud service. Requires login + memory selection.

Supported IDEs:
${getSupportedIdeIds()
  .map((ideId) => {
    const config = getIdeConfig(ideId);
    return `  ${ideId.padEnd(14)} -> ${config?.rules_file ?? ""}`;
  })
  .join("\n")}
`);
}

/**
 * Prompt the user to pick one or more IDEs from a numbered list.
 * Returns an array of IDE ids.  Accepts single number, comma-separated
 * numbers, or "all".
 */
export async function promptIdeSelection(ideChoices, promptFn) {
  if (!promptFn) {
    return [];
  }

  console.log("");
  ideChoices.forEach((ide, i) => {
    const config = getIdeConfig(ide);
    console.log(`  ${i + 1}. ${config?.label ?? ide}`);
  });
  console.log("");

  const answer = String(await promptFn(`Select IDE (1-${ideChoices.length}, comma-separated, or "all") [1]: `)).trim();

  if (!answer || answer === "1") {
    return [ideChoices[0]];
  }
  if (answer.toLowerCase() === "all") {
    return [...ideChoices];
  }

  const selected = [];
  for (const part of answer.split(",")) {
    const num = Number(part.trim());
    if (Number.isInteger(num) && num >= 1 && num <= ideChoices.length) {
      const ide = ideChoices[num - 1];
      if (!selected.includes(ide)) {
        selected.push(ide);
      }
    }
  }
  return selected.length > 0 ? selected : [ideChoices[0]];
}

/**
 * Handle MCP config for IDEs that have no project-level JSON path:
 * - Global file (Windsurf, Antigravity): write directly to ~/... path
 * - TOML project file (Codex): write .codex/config.toml
 * - UI-based (Cline, Zed, Augment): print filled-in copy-paste snippet
 */
async function _handleUnsupportedMcp({ ideId, config, mcpInputs, dryRun }) {
  const hasCreds = Boolean(mcpInputs.mcpUrl && mcpInputs.apiKey && mcpInputs.memoryId);

  // 1. Global file (Windsurf, Antigravity)
  const globalPath = getIdeMcpGlobalPath(ideId);
  if (globalPath) {
    if (!hasCreds) {
      const displayPath = config?.mcp_global_path ?? globalPath;
      console.log(`ℹ MCP config for ${config?.label ?? ideId} lives at ${displayPath}`);
      console.log(`  Re-run with auth (or --api-key / --memory-id / --mcp-url) to write it automatically.`);
      return;
    }
    const mcpResult = syncIdeMcpGlobalConfig({ ideId, dryRun, ...mcpInputs });
    if (!mcpResult.ok) {
      console.error(`Conflict while syncing ${mcpResult.filePath}: ${mcpResult.reason}`);
      return;
    }
    const label = { create: dryRun ? "Would create" : "Created", replace: dryRun ? "Would merge" : "Merged", noop: "Already up to date" }[mcpResult.action] ?? mcpResult.action;
    if (mcpResult.action === "noop") {
      console.log(`✓ ${mcpResult.filePath} already up to date.`);
    } else {
      console.log(`✓ ${label} ${mcpResult.filePath}`);
      if (dryRun) console.log(mcpResult.content);
    }
    return;
  }

  // 2. TOML project file (Codex)
  const ideConfig = getIdeConfig(ideId);
  if (ideConfig?.mcp_path_toml) {
    if (!hasCreds) {
      console.log(`ℹ MCP config for ${ideConfig.label} is written to ${ideConfig.mcp_path_toml} (TOML format).`);
      console.log(`  Re-run with auth (or --api-key / --memory-id / --mcp-url) to write it automatically.`);
      return;
    }
    const mcpResult = syncIdeMcpTomlConfig({ ideId, dryRun, ...mcpInputs });
    if (!mcpResult.ok) {
      console.error(`Error syncing ${mcpResult.filePath ?? ideConfig.mcp_path_toml}: ${mcpResult.reason}`);
      return;
    }
    const label = { create: dryRun ? "Would create" : "Created", replace: dryRun ? "Would append" : "Appended", noop: "Already up to date" }[mcpResult.action] ?? mcpResult.action;
    if (mcpResult.action === "noop") {
      console.log(`✓ ${mcpResult.filePath} already up to date.`);
    } else {
      console.log(`✓ ${label} ${mcpResult.filePath}`);
      if (dryRun) console.log(mcpResult.content);
    }
    return;
  }

  // 3. UI-based: show filled-in snippet (Cline, Zed, Augment)
  const snippet = buildMcpSnippet(ideId, mcpInputs);
  if (snippet) {
    console.log(snippet);
  } else {
    console.log(`ℹ ${config?.label ?? ideId} does not support automatic MCP configuration.`);
    if (hasCreds) {
      console.log(`  MCP URL:   ${mcpInputs.mcpUrl}`);
      console.log(`  API Key:   ${mcpInputs.apiKey}`);
      console.log(`  Memory ID: ${mcpInputs.memoryId}`);
    }
  }
}

/**
 * Sync rules + optional MCP config for a single IDE.  Returns 0 on success, 1 on error.
 */
async function syncOneIde({ ideId, argv, dryRun, force }) {
  const config = getIdeConfig(ideId);
  console.log(`\nConfiguring ${config?.label ?? ideId}...`);

  // --- OpenClaw special path: plugin config instead of rules + MCP ---
  if (ideId === "openclaw") {
    return syncOneIdeOpenClaw({ argv, dryRun });
  }

  const result = syncIdeRules({ ideId, dryRun, force });

  if (!result.ok) {
    console.error(`Conflict while syncing ${result.filePath}: ${result.reason}`);
    if (result.strategy === "managed_file" && !force) {
      console.error("Re-run with --force only if you want Awareness to take ownership of that file.");
    }
    return 1;
  }

  const actionLabel = {
    create: dryRun ? "Would create" : "Created",
    append: dryRun ? "Would append" : "Appended",
    replace: dryRun ? "Would replace" : "Replaced",
    noop: "Already up to date",
  }[result.action] ?? result.action;

  if (result.action === "noop") {
    console.log(`✓ ${result.filePath} ${actionLabel.toLowerCase()}.`);
  } else {
    console.log(`✓ ${actionLabel} ${result.filePath}`);
    if (dryRun) {
      console.log(result.content);
    }
  }

  const mcpInputs = await resolveMcpConfigInputs({ argv, ideId });
  if (mcpInputs.shouldSync) {
    if (mcpInputs.unsupported) {
      await _handleUnsupportedMcp({ ideId, config, mcpInputs, dryRun });
      return 0;
    }

    if (!mcpInputs.mcpUrl || !mcpInputs.apiKey || !mcpInputs.memoryId) {
      console.error("To sync MCP config, provide or enter mcpUrl, apiKey, and memoryId.");
      return 1;
    }

    const mcpResult = syncIdeMcpConfig({
      ideId,
      dryRun,
      mcpUrl: mcpInputs.mcpUrl,
      apiKey: mcpInputs.apiKey,
      memoryId: mcpInputs.memoryId,
      agentRole: mcpInputs.agentRole,
      serverName: mcpInputs.serverName,
    });

    if (!mcpResult.ok) {
      console.error(`Conflict while syncing ${mcpResult.filePath}: ${mcpResult.reason}`);
      return 1;
    }

    const mcpActionLabel = {
      create: dryRun ? "Would create" : "Created",
      replace: dryRun ? "Would merge" : "Merged",
      noop: "Already up to date",
    }[mcpResult.action] ?? mcpResult.action;

    if (mcpResult.action === "noop") {
      console.log(`✓ ${mcpResult.filePath} already up to date.`);
    } else {
      console.log(`✓ ${mcpActionLabel} ${mcpResult.filePath}`);
      if (dryRun) {
        console.log(mcpResult.content);
      }
    }
  }

  return 0;
}

/**
 * OpenClaw-specific sync: write plugin config to ~/.openclaw/openclaw.json.
 * OpenClaw uses a native plugin system, so no separate rules file or MCP JSON is needed.
 */
async function syncOneIdeOpenClaw({ argv, dryRun }) {
  const readArg = (name, envKey = "") => {
    const index = argv.indexOf(name);
    if (index !== -1 && argv[index + 1]) {
      return argv[index + 1];
    }
    return envKey ? (process.env[envKey] ?? "") : "";
  };

  const apiKey = readArg("--api-key", "AWARENESS_API_KEY");
  const memoryId = readArg("--memory-id", "AWARENESS_MEMORY_ID");
  const agentRole = readArg("--agent-role", "AWARENESS_AGENT_ROLE") || "builder_agent";
  // Derive baseUrl from MCP URL or api-base
  let baseUrl = readArg("--api-base") || "https://awareness.market/api/v1";
  const mcpUrl = readArg("--mcp-url", "AWARENESS_MCP_URL");
  if (mcpUrl && mcpUrl.endsWith("/mcp")) {
    baseUrl = mcpUrl.replace(/\/mcp$/, "/api/v1");
  }

  if (!apiKey || !memoryId) {
    console.error("To configure OpenClaw, provide apiKey and memoryId (via auth or --api-key / --memory-id).");
    return 1;
  }

  const result = syncOpenClawConfig({
    apiKey,
    memoryId,
    agentRole,
    baseUrl,
    dryRun,
  });

  if (!result.ok) {
    console.error(`Conflict while syncing ${result.filePath}: ${result.reason}`);
    return 1;
  }

  const actionLabel = {
    create: dryRun ? "Would create" : "Created",
    replace: dryRun ? "Would update" : "Updated",
    noop: "Already up to date",
  }[result.action] ?? result.action;

  if (result.action === "noop") {
    console.log(`✓ ${result.filePath} already up to date.`);
  } else {
    console.log(`✓ ${actionLabel} ${result.filePath}`);
    if (dryRun) {
      console.log(result.content);
    }
  }

  console.log("ℹ OpenClaw uses a native plugin system — workflow rules are injected automatically by the Awareness plugin.");

  if (!dryRun) {
    // Attempt to auto-install the Awareness plugin via the openclaw CLI
    const { execSync } = await import("node:child_process");
    let installed = false;
    try {
      execSync("openclaw plugins install @awareness-sdk/openclaw-memory", { stdio: "pipe" });
      console.log("✓ Awareness plugin installed in OpenClaw.");
      installed = true;
    } catch {
      // plugins install failed, try skill install as fallback
      try {
        execSync("npx clawhub@latest install awareness-memory --force", { stdio: "pipe" });
        console.log("✓ Awareness skill installed in OpenClaw via ClawHub.");
        installed = true;
      } catch {
        // both failed
      }
    }
    if (!installed) {
      console.log("ℹ To install the Awareness plugin, run one of:");
      console.log("    openclaw plugins install @awareness-sdk/openclaw-memory");
      console.log("    npx clawhub@latest install awareness-memory");
    }

    if (result.action !== "noop") {
      console.log("ℹ Restart OpenClaw to apply the new configuration.");
    }
  }

  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return 0;
  }

  if (argv.includes("--list")) {
    console.log("Supported IDEs:");
    for (const ideId of getSupportedIdeIds()) {
      const config = getIdeConfig(ideId);
      console.log(`  ${ideId.padEnd(14)} -> ${config?.rules_file ?? ""}`);
    }
    return 0;
  }

  if (argv.includes("--logout")) {
    clearCredentials();
    console.log("Credentials cleared.");
    return 0;
  }

  if (argv.includes("doctor") || argv.includes("--doctor")) {
    return await doctorCommand();
  }

  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const noAuth = argv.includes("--no-auth");
  const cloudFlag = argv.includes("--cloud");
  const isInteractive = Boolean(process.stdin?.isTTY && process.stdout?.isTTY);
  const ask = isInteractive ? createQuestionPrompt() : null;

  // Read explicit CLI args that skip auth flow
  const readArg = (name) => {
    const idx = argv.indexOf(name);
    return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : "";
  };
  const apiBaseArg = readArg("--api-base") || "https://awareness.market/api/v1";
  const apiKeyArg = readArg("--api-key");
  const memoryIdArg = readArg("--memory-id");
  const mcpUrlArg = readArg("--mcp-url");

  // --- Determine mode: local (default) vs cloud ---
  // Cloud mode if: --cloud flag, OR explicit --api-key/--mcp-url provided
  const hasExplicitCloudArgs = Boolean(apiKeyArg || mcpUrlArg);
  const isCloudMode = cloudFlag || hasExplicitCloudArgs;
  const isLocalMode = !isCloudMode && !noAuth;

  // =========================================================================
  // LOCAL MODE (default): start daemon, sync rules + MCP with local URL
  // =========================================================================
  if (isLocalMode) {
    return await runLocalMode({ argv, dryRun, force, ask, isInteractive });
  }

  // =========================================================================
  // CLOUD MODE (--cloud or explicit credentials): existing auth flow
  // =========================================================================

  // --- Auth + Memory selection (unless --no-auth or explicit args provided) ---
  let authApiKey = apiKeyArg;
  let authApiBase = apiBaseArg;
  let authMemoryId = memoryIdArg;
  let authMemoryName = "";

  const hasExplicitMcpArgs = Boolean(apiKeyArg && memoryIdArg);

  if (!noAuth && !hasExplicitMcpArgs && !dryRun) {
    // Run auth flow
    const creds = await runAuthFlow(apiBaseArg, { prompt: ask });
    if (creds) {
      authApiKey = creds.api_key;
      authApiBase = creds.api_base || apiBaseArg;

      // Run memory selection flow
      const memResult = await runMemoryFlow(authApiBase, authApiKey, {
        prompt: ask,
      });
      if (memResult) {
        authMemoryId = memResult.memoryId;
        authMemoryName = memResult.memoryName || "";
      }
    }
  }

  // --- Resolve which IDE(s) to configure ---
  const ideTargets = await resolveIdeTargets({ argv, ask });
  if (ideTargets === null) return 1;

  // --- Build argv with auth-resolved values for syncOneIde ---
  const effectiveArgv = [...argv];
  if (authApiKey && !apiKeyArg) {
    effectiveArgv.push("--api-key", authApiKey);
  }
  if (authMemoryId && !memoryIdArg) {
    effectiveArgv.push("--memory-id", authMemoryId);
  }
  // If we have both api key and memory id from auth, auto-set MCP URL
  if (authApiKey && authMemoryId && !mcpUrlArg) {
    const mcpBase = authApiBase.replace(/\/api\/v1\/?$/, "");
    effectiveArgv.push("--mcp-url", `${mcpBase}/mcp`);
  }

  // --- Sync each selected IDE ---
  let hasError = false;
  try {
    for (const ideId of ideTargets) {
      const exitCode = await syncOneIde({ ideId, argv: effectiveArgv, dryRun, force });
      if (exitCode !== 0) {
        hasError = true;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }

  if (ideTargets.length > 1 && !hasError) {
    console.log(`\n✓ Configured ${ideTargets.length} IDEs successfully.`);
  }

  // --- Show token savings summary (if logged in) ---
  if (authApiKey && !dryRun && !hasError) {
    const savings = await getTokenSavings(authApiBase, authApiKey);
    const summary = formatTokenSavings(savings);
    if (summary) {
      console.log(`\n${summary}`);
    }
  }

  return hasError ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Local mode implementation
// ---------------------------------------------------------------------------

async function runLocalMode({ argv, dryRun, force, ask, isInteractive }) {
  console.log("\n🏠 Awareness Local Mode");
  console.log("Your memories stay on your machine. No account needed.\n");

  // Resolve IDEs early so we fail fast on bad --ide before starting the daemon
  const ideTargets = await resolveIdeTargets({ argv, ask });
  if (ideTargets === null) return 1;

  // In dry-run mode, skip daemon start/check — just preview config files
  if (!dryRun) {
    // 1. Prompt for embedding language (interactive only)
    let embeddingLang = "en"; // default: English only (smaller model)
    if (ask) {
      console.log("Embedding model language support:");
      console.log("  1. English only  (~23 MB, faster)");
      console.log("  2. All languages (~118 MB, multilingual)");
      const langChoice = String(await ask("Select [1]: ")).trim();
      if (langChoice === "2") {
        embeddingLang = "multi";
        console.log("→ Multilingual embedding model selected.\n");
      } else {
        console.log("→ English-only embedding model selected.\n");
      }
    }

    // 2. Check if daemon is already running
    console.log("Checking local daemon...");
    let daemonReady = await checkDaemonHealth();

    if (daemonReady) {
      console.log("✓ Local daemon is already running.\n");
    } else {
      // 3. Try to start daemon
      console.log("Starting local daemon...");
      const started = await tryStartDaemon(embeddingLang);

      if (!started) {
        console.error("Could not start the local daemon.");
        console.error("Install it first:  npm install -g @awareness-sdk/local");
        console.error("Or start manually: npx @awareness-sdk/local start");
        console.error("\nTo use cloud mode instead: npx @awareness-sdk/setup --cloud");
        return 1;
      }

      // 4. Wait for daemon to be ready. First-run takes longer because npx
      // fetches @awareness-sdk/local from npm and compiles better-sqlite3.
      // 90s accommodates that; subsequent runs hit cache and finish in ~2s.
      process.stdout.write("Waiting for daemon to be ready (first install can take ~60s)");
      const pollStart = Date.now();
      const maxWait = 90000;
      const pollInterval = 500;
      while (Date.now() - pollStart < maxWait) {
        if (await checkDaemonHealth()) {
          daemonReady = true;
          break;
        }
        process.stdout.write(".");
        await new Promise((r) => setTimeout(r, pollInterval));
      }
      console.log("");

      if (!daemonReady) {
        // Don't hard-fail: the daemon may still be downloading native deps.
        // Print actionable next-steps and continue with MCP config sync so
        // the user's IDE wires up correctly even if daemon comes up late.
        console.warn("⚠️  Daemon did not become ready within 90 seconds.");
        console.warn("   It may still be installing native dependencies in the background.");
        console.warn("   Check status:   npx @awareness-sdk/local logs");
        console.warn("   Or start manually: npx @awareness-sdk/local start");
        console.warn("   MCP config will still be written so your IDE can connect once it's up.");
      } else {
        console.log("✓ Local daemon started successfully.\n");
      }
    }
  }

  // 6. Sync rules + MCP config for each IDE (local mode: no auth headers)
  let hasError = false;
  try {
    for (const ideId of ideTargets) {
      const exitCode = await syncOneIdeLocal({ ideId, dryRun, force });
      if (exitCode !== 0) {
        hasError = true;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }

  if (ideTargets.length > 1 && !hasError) {
    console.log(`\n✓ Configured ${ideTargets.length} IDEs successfully.`);
  }

  if (!hasError && !dryRun) {
    console.log("\n────────────────────────────────────────");
    console.log("✓ Awareness is running locally on your machine.");
    console.log(`  MCP endpoint: ${LOCAL_MCP_URL}`);
    console.log("  Dashboard:    http://localhost:37800/");
    console.log("  Your data never leaves your computer.");
    console.log("\n  Want cloud sync & collaboration?");
    console.log("  → npx @awareness-sdk/setup --cloud");
    console.log("────────────────────────────────────────");
    // Dashboard auto-open is handled by the local daemon on first run.
  }

  return hasError ? 1 : 0;
}

/**
 * Sync rules + MCP config for a single IDE in local mode.
 * Similar to syncOneIde but uses local daemon URL without auth headers.
 */
async function syncOneIdeLocal({ ideId, dryRun, force }) {
  const config = getIdeConfig(ideId);
  console.log(`\nConfiguring ${config?.label ?? ideId}...`);

  // OpenClaw is cloud-only (needs apiKey + memoryId for plugin config)
  if (ideId === "openclaw") {
    console.log("ℹ OpenClaw requires cloud mode. Run: npx @awareness-sdk/setup --cloud");
    return 1;
  }

  // --- Sync workflow rules (same as cloud mode) ---
  const result = syncIdeRules({ ideId, dryRun, force });

  if (!result.ok) {
    console.error(`Conflict while syncing ${result.filePath}: ${result.reason}`);
    if (result.strategy === "managed_file" && !force) {
      console.error("Re-run with --force only if you want Awareness to take ownership of that file.");
    }
    return 1;
  }

  const actionLabel = {
    create: dryRun ? "Would create" : "Created",
    append: dryRun ? "Would append" : "Appended",
    replace: dryRun ? "Would replace" : "Replaced",
    noop: "Already up to date",
  }[result.action] ?? result.action;

  if (result.action === "noop") {
    console.log(`✓ ${result.filePath} ${actionLabel.toLowerCase()}.`);
  } else {
    console.log(`✓ ${actionLabel} ${result.filePath}`);
    if (dryRun) {
      console.log(result.content);
    }
  }

  // --- Sync MCP config (local mode: no auth headers) ---
  const mcpPath = getIdeMcpPath(ideId);
  if (!mcpPath) {
    // Handle IDEs that don't have a project-level MCP JSON path
    await _handleUnsupportedMcpLocal({ ideId, config, dryRun });
    return 0;
  }

  const mcpResult = syncIdeMcpConfig({
    ideId,
    dryRun,
    mcpUrl: LOCAL_MCP_URL,
    isLocal: true,
  });

  if (!mcpResult.ok) {
    console.error(`Conflict while syncing ${mcpResult.filePath}: ${mcpResult.reason}`);
    return 1;
  }

  const mcpActionLabel = {
    create: dryRun ? "Would create" : "Created",
    replace: dryRun ? "Would merge" : "Merged",
    noop: "Already up to date",
  }[mcpResult.action] ?? mcpResult.action;

  if (mcpResult.action === "noop") {
    console.log(`✓ ${mcpResult.filePath} already up to date.`);
  } else {
    console.log(`✓ ${mcpActionLabel} ${mcpResult.filePath}`);
    if (dryRun) {
      console.log(mcpResult.content);
    }
  }

  return 0;
}

/**
 * Handle MCP config for IDEs without project-level JSON in local mode.
 */
async function _handleUnsupportedMcpLocal({ ideId, config, dryRun }) {
  // 1. Global file (Windsurf, Antigravity)
  const globalPath = getIdeMcpGlobalPath(ideId);
  if (globalPath) {
    const mcpResult = syncIdeMcpGlobalConfig({
      ideId,
      dryRun,
      mcpUrl: LOCAL_MCP_URL,
      isLocal: true,
    });
    if (!mcpResult.ok) {
      console.error(`Conflict while syncing ${mcpResult.filePath}: ${mcpResult.reason}`);
      return;
    }
    const label = { create: dryRun ? "Would create" : "Created", replace: dryRun ? "Would merge" : "Merged", noop: "Already up to date" }[mcpResult.action] ?? mcpResult.action;
    if (mcpResult.action === "noop") {
      console.log(`✓ ${mcpResult.filePath} already up to date.`);
    } else {
      console.log(`✓ ${label} ${mcpResult.filePath}`);
      if (dryRun) console.log(mcpResult.content);
    }
    return;
  }

  // 2. TOML project file (Codex) — local mode doesn't need auth headers in TOML either
  const ideConfig = getIdeConfig(ideId);
  if (ideConfig?.mcp_path_toml) {
    // For TOML format, build a simplified local config block
    const tomlBlock = [
      `[mcp_servers.awareness-memory]`,
      `url = "${LOCAL_MCP_URL}"`,
      ``,
    ].join("\n");
    console.log(`ℹ Add the following to ${ideConfig.mcp_path_toml}:`);
    console.log(tomlBlock);
    return;
  }

  // 3. UI-based (Cline, Zed, Augment): print simplified local snippet
  const stdJson = JSON.stringify(
    { "awareness-memory": { url: LOCAL_MCP_URL } },
    null,
    2
  );

  if (normalizeIdeId(ideId) === "cline") {
    console.log(`ℹ Cline manages MCP servers through its Settings UI:`);
    console.log(`  1. Open VS Code → Cline sidebar → Settings (⚙) → MCP Servers → + Add Server`);
    console.log(`  2. Select type: HTTP`);
    console.log(`  3. Enter:`);
    console.log(`       Name: awareness-memory`);
    console.log(`       URL:  ${LOCAL_MCP_URL}`);
    console.log(`  Or paste this JSON:`);
    console.log(stdJson);
  } else if (normalizeIdeId(ideId) === "zed") {
    const zedEntry = JSON.stringify(
      { "awareness-bridge": { command: "npx", args: ["-y", "mcp-remote", LOCAL_MCP_URL] } },
      null,
      2
    );
    console.log(`ℹ Zed: add to "context_servers" in ~/.config/zed/settings.json:`);
    console.log(zedEntry);
  } else {
    console.log(`ℹ ${config?.label ?? ideId}: add this MCP server config:`);
    console.log(stdJson);
  }
}

// ---------------------------------------------------------------------------
// Shared IDE resolution helper (used by both local and cloud mode)
// ---------------------------------------------------------------------------

/**
 * Resolve which IDE(s) to configure. Returns array of IDE ids, or null on error.
 */
async function resolveIdeTargets({ argv, ask }) {
  let ideTargets = [];

  const ideIndex = argv.indexOf("--ide");
  if (ideIndex !== -1 && argv[ideIndex + 1]) {
    // Explicit --ide flag: use exactly that IDE
    const normalized = normalizeIdeId(argv[ideIndex + 1]);
    if (!normalized) {
      console.error(`Unknown IDE: ${argv[ideIndex + 1]}`);
      console.log(`Supported: ${getSupportedIdeIds().join(", ")}`);
      return null;
    }
    ideTargets = [normalized];
  } else {
    // Auto-detect all matching IDEs in the project directory
    const detected = autoDetectAllIdes();

    if (detected.length === 0) {
      // Nothing detected — interactive selection or graceful headless fallback
      if (!ask) {
        // Headless: still start the daemon (return [] to skip per-IDE sync)
        // and print clear next-step instructions. Previously we exited 1 here,
        // which broke fresh-user installs in containers / CI / SSH where no
        // IDE is present yet. The daemon URL the user can wire into any MCP
        // client is now printed at the end of runLocalMode regardless.
        console.log("ℹ️  No IDE detected. Continuing with daemon-only setup.");
        console.log(`   To wire MCP later, run: npx @awareness-sdk/setup --ide <name>`);
        console.log(`   Supported: ${getSupportedIdeIds().join(", ")}`);
        return [];
      }

      console.log("Could not auto-detect IDE in this directory.");
      console.log("Which IDE do you use?");
      const allIdes = getSupportedIdeIds();
      ideTargets = await promptIdeSelection(allIdes, ask);
    } else if (detected.length === 1) {
      // Single IDE detected — use it directly
      ideTargets = detected;
    } else {
      // Multiple IDEs detected
      if (!ask) {
        // Non-interactive: configure all detected IDEs
        ideTargets = detected;
      } else {
        const labels = detected.map((id) => getIdeConfig(id)?.label ?? id).join(", ");
        console.log(`Found multiple IDEs: ${labels}`);
        console.log("Which would you like to configure?");
        ideTargets = await promptIdeSelection(detected, ask);
      }
    }
  }

  // Empty array (no IDE) is allowed in headless mode — daemon-only setup.
  // Only treat null as a hard error.
  return ideTargets;
}


// Resolve symlinks so npx (which uses symlinked binaries) correctly detects
// this as the main module. Fallback to URL comparison if realpath fails.
function _isMainModule() {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (_isMainModule()) {
  process.exitCode = await main();
}
