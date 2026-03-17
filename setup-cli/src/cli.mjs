#!/usr/bin/env node

/**
 * @awareness-sdk/setup - Sync Awareness Memory workflow rules into IDE config files.
 */

import readline from "node:readline";
import { pathToFileURL } from "node:url";

import {
  autoDetectAllIdes,
  autoDetectIde,
  getIdeConfig,
  getIdeMcpPath,
  getSupportedIdeIds,
  normalizeIdeId,
  syncIdeMcpConfig,
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

export function printUsage() {
  console.log(`
@awareness-sdk/setup - Set up Awareness Memory for your IDE

Usage:
  npx @awareness-sdk/setup                 Login, select memory, auto-detect IDE, sync rules + MCP
  npx @awareness-sdk/setup --ide cursor    Force specific IDE
  npx @awareness-sdk/setup --no-auth       Skip login (rules only, no MCP config)
  npx @awareness-sdk/setup --configure-mcp Prompt for MCP config values manually
  npx @awareness-sdk/setup --mcp-url <url> --api-key <key> --memory-id <id>
                                           Provide MCP config values directly (skip auth)
  npx @awareness-sdk/setup --dry-run       Preview without writing
  npx @awareness-sdk/setup --force         Allow overwrite for managed files without markers
  npx @awareness-sdk/setup --list          Show supported IDEs
  npx @awareness-sdk/setup --logout        Clear saved credentials
  npx @awareness-sdk/setup --api-base <url> Use custom API base URL

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
      console.log(`ℹ ${ideId} does not use a file-based MCP config. Rules were synced, but MCP config was not written.`);
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
  if (!dryRun && result.action !== "noop") {
    console.log("ℹ Restart OpenClaw to apply the new configuration.");
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

  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const noAuth = argv.includes("--no-auth");
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
  let ideTargets = [];

  const ideIndex = argv.indexOf("--ide");
  if (ideIndex !== -1 && argv[ideIndex + 1]) {
    // Explicit --ide flag: use exactly that IDE
    const normalized = normalizeIdeId(argv[ideIndex + 1]);
    if (!normalized) {
      console.error(`Unknown IDE: ${argv[ideIndex + 1]}`);
      console.log(`Supported: ${getSupportedIdeIds().join(", ")}`);
      return 1;
    }
    ideTargets = [normalized];
  } else {
    // Auto-detect all matching IDEs in the project directory
    const detected = autoDetectAllIdes();

    if (detected.length === 0) {
      // Nothing detected — interactive selection or error
      if (!ask) {
        console.log("Could not auto-detect IDE. Use --ide <name> to specify.");
        console.log(`Supported: ${getSupportedIdeIds().join(", ")}`);
        console.log("\nHint: Run this from your project root directory.");
        return 1;
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

  if (ideTargets.length === 0) {
    console.log("No IDE selected.");
    return 1;
  }

  // --- Build argv with auth-resolved values for syncOneIde ---
  const effectiveArgv = [...argv];
  if (authApiKey && !apiKeyArg) {
    effectiveArgv.push("--api-key", authApiKey);
  }
  if (authMemoryId && !memoryIdArg) {
    effectiveArgv.push("--memory-id", authMemoryId);
  }
  // If we have both api key and memory id from auth, auto-set MCP URL
  const mcpUrlArg = readArg("--mcp-url");
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


if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
