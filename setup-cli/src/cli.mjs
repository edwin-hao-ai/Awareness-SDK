#!/usr/bin/env node

/**
 * @awareness-sdk/setup - Sync Awareness Memory workflow rules into IDE config files.
 */

import { pathToFileURL } from "node:url";

import {
  autoDetectIde,
  getIdeConfig,
  getSupportedIdeIds,
  normalizeIdeId,
  syncIdeRules,
} from "./rules.mjs";

export function printUsage() {
  console.log(`
@awareness-sdk/setup - Sync Awareness Memory workflow rules into IDE config files

Usage:
  npx @awareness-sdk/setup                 Auto-detect IDE and sync rules
  npx @awareness-sdk/setup --ide cursor    Force specific IDE
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

export function main(argv = process.argv.slice(2)) {
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
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}


if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
