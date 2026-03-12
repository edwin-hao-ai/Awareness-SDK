#!/usr/bin/env node

/**
 * @awareness-sdk/setup - Sync Awareness Memory workflow rules into IDE config files.
 */

import readline from "node:readline";
import { pathToFileURL } from "node:url";

import {
  autoDetectIde,
  getIdeConfig,
  getIdeMcpPath,
  getSupportedIdeIds,
  normalizeIdeId,
  syncIdeMcpConfig,
  syncIdeRules,
} from "./rules.mjs";

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
@awareness-sdk/setup - Sync Awareness Memory workflow rules into IDE config files

Usage:
  npx @awareness-sdk/setup                 Auto-detect IDE and sync rules
  npx @awareness-sdk/setup --ide cursor    Force specific IDE
  npx @awareness-sdk/setup --ide copilot   Force VS Code Copilot
  npx @awareness-sdk/setup --configure-mcp Prompt for MCP config values and write them too
  npx @awareness-sdk/setup --mcp-url <url> --api-key <key> --memory-id <id>
                                           Also create/merge MCP config when supported
  npx @awareness-sdk/setup --dry-run       Preview without writing
  npx @awareness-sdk/setup --force         Allow overwrite for managed files without markers
  npx @awareness-sdk/setup --list          Show supported IDEs

Supported IDEs:
${getSupportedIdeIds()
  .map((ideId) => {
    const config = getIdeConfig(ideId);
    return `  ${ideId.padEnd(14)} -> ${config?.rules_file ?? ""}`;
  })
  .join("\n")}
`);
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

  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");

  let requestedIde = null;
  const ideIndex = argv.indexOf("--ide");
  if (ideIndex !== -1 && argv[ideIndex + 1]) {
    requestedIde = normalizeIdeId(argv[ideIndex + 1]);
  } else {
    requestedIde = autoDetectIde();
  }

  if (!requestedIde) {
    console.log("Could not auto-detect IDE. Use --ide <name> to specify.");
    console.log(`Supported: ${getSupportedIdeIds().join(", ")}`);
    console.log("\nHint: Run this from your project root directory.");
    return 1;
  }

  const config = getIdeConfig(requestedIde);
  console.log(`Detected IDE: ${config?.label ?? requestedIde}`);

  try {
    const result = syncIdeRules({
      ideId: requestedIde,
      dryRun,
      force,
    });

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
      return 0;
    }

    console.log(`✓ ${actionLabel} ${result.filePath}`);
    if (dryRun) {
      console.log(result.content);
    }

    const mcpInputs = await resolveMcpConfigInputs({ argv, ideId: requestedIde });
    if (mcpInputs.shouldSync) {
      if (mcpInputs.unsupported) {
        console.log(`ℹ ${requestedIde} does not use a file-based MCP config. Rules were synced, but MCP config was not written.`);
        return 0;
      }

      if (!mcpInputs.mcpUrl || !mcpInputs.apiKey || !mcpInputs.memoryId) {
        console.error("To sync MCP config, provide or enter mcpUrl, apiKey, and memoryId.");
        return 1;
      }

      const mcpResult = syncIdeMcpConfig({
        ideId: requestedIde,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}


if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
