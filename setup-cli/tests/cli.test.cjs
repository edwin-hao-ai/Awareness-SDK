const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let cliModule;
let rulesModule;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "awareness-setup-"));
}

test.before(async () => {
  cliModule = await import("../src/cli.mjs");
  rulesModule = await import("../src/rules.mjs");
});

test("syncIdeRules creates managed_block files when missing", () => {
  const cwd = makeTempDir();

  const result = rulesModule.syncIdeRules({ cwd, ideId: "codex" });
  const content = fs.readFileSync(path.join(cwd, "AGENTS.md"), "utf-8");

  assert.equal(result.action, "create");
  assert.match(content, /AWARENESS_RULES_START/);
});

test("syncIdeRules creates VS Code Copilot instructions when missing", () => {
  const cwd = makeTempDir();

  const result = rulesModule.syncIdeRules({ cwd, ideId: "copilot" });
  const content = fs.readFileSync(path.join(cwd, ".github", "copilot-instructions.md"), "utf-8");

  assert.equal(result.action, "create");
  assert.match(content, /VS Code Copilot Notes/);
});

test("syncIdeMcpConfig creates VS Code MCP config when missing", () => {
  const cwd = makeTempDir();

  const result = rulesModule.syncIdeMcpConfig({
    cwd,
    ideId: "copilot",
    mcpUrl: "https://awareness.market/mcp",
    apiKey: "aw_test",
    memoryId: "mem_123",
  });
  const content = fs.readFileSync(path.join(cwd, ".vscode", "mcp.json"), "utf-8");

  assert.equal(result.ok, true);
  assert.equal(result.action, "create");
  assert.match(content, /awareness-memory/);
  assert.match(content, /X-Awareness-Memory-Id/);
});

test("syncIdeMcpConfig merges into existing MCP config JSON", () => {
  const cwd = makeTempDir();
  const filePath = path.join(cwd, ".vscode", "mcp.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({ mcpServers: { other: { url: "http://localhost:9999" } } }, null, 2) + "\n",
    "utf-8",
  );

  const result = rulesModule.syncIdeMcpConfig({
    cwd,
    ideId: "copilot",
    mcpUrl: "https://awareness.market/mcp",
    apiKey: "aw_test",
    memoryId: "mem_123",
  });
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  assert.equal(result.ok, true);
  assert.equal(result.action, "replace");
  assert.ok(parsed.mcpServers.other);
  assert.ok(parsed.mcpServers["awareness-memory"]);
});

test("syncIdeRules appends managed_block when file has no markers", () => {
  const cwd = makeTempDir();
  const filePath = path.join(cwd, "CLAUDE.md");
  fs.writeFileSync(filePath, "# Existing\n\nUser content.\n", "utf-8");

  const result = rulesModule.syncIdeRules({ cwd, ideId: "claude-code" });
  const content = fs.readFileSync(filePath, "utf-8");

  assert.equal(result.action, "append");
  assert.match(content, /^# Existing/);
  assert.match(content, /AWARENESS_RULES_END/);
});

test("syncIdeRules replaces existing managed_block content", () => {
  const cwd = makeTempDir();
  const markers = rulesModule.getMarkers();
  const filePath = path.join(cwd, "AGENTS.md");
  fs.writeFileSync(
    filePath,
    `# Existing\n\n${markers.start}\n# Old block\n${markers.end}\n`,
    "utf-8",
  );

  const result = rulesModule.syncIdeRules({ cwd, ideId: "codex" });
  const content = fs.readFileSync(filePath, "utf-8");

  assert.equal(result.action, "replace");
  assert.doesNotMatch(content, /Old block/);
  assert.match(content, /Codex-Specific Notes/);
});

test("syncIdeRules is idempotent when managed content is already current", () => {
  const cwd = makeTempDir();

  const first = rulesModule.syncIdeRules({ cwd, ideId: "codex" });
  const second = rulesModule.syncIdeRules({ cwd, ideId: "codex" });

  assert.equal(first.action, "create");
  assert.equal(second.action, "noop");
});

test("syncIdeRules returns conflict for broken managed_block markers", () => {
  const cwd = makeTempDir();
  const markers = rulesModule.getMarkers();
  fs.writeFileSync(path.join(cwd, "CLAUDE.md"), `${markers.start}\nmissing end marker\n`, "utf-8");

  const result = rulesModule.syncIdeRules({ cwd, ideId: "claude-code" });

  assert.equal(result.ok, false);
  assert.equal(result.action, "conflict");
});

test("syncIdeRules returns conflict for unmanaged cursor file", () => {
  const cwd = makeTempDir();
  const filePath = path.join(cwd, ".cursor", "rules", "awareness.mdc");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "---\ndescription: user managed\n---\n# User content\n", "utf-8");

  const result = rulesModule.syncIdeRules({ cwd, ideId: "cursor" });

  assert.equal(result.ok, false);
  assert.equal(result.action, "conflict");
  assert.match(result.reason, /without Awareness markers/);
});

test("syncIdeRules can force replace unmanaged cursor file", () => {
  const cwd = makeTempDir();
  const filePath = path.join(cwd, ".cursor", "rules", "awareness.mdc");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "---\ndescription: user managed\n---\n# User content\n", "utf-8");

  const result = rulesModule.syncIdeRules({ cwd, ideId: "cursor", force: true });
  const content = fs.readFileSync(filePath, "utf-8");

  assert.equal(result.ok, true);
  assert.equal(result.action, "replace");
  assert.match(content, /Awareness Memory Rules/);
});

test("CLI dry-run previews changes without writing files", async () => {
  const cwd = makeTempDir();
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
    const exitCode = await cliModule.main(["--ide", "codex", "--dry-run"]);

    assert.equal(exitCode, 0);
    assert.equal(fs.existsSync(path.join(cwd, "AGENTS.md")), false);
  } finally {
    process.chdir(originalCwd);
  }
});

test("resolveMcpConfigInputs prompts for missing MCP values in interactive mode", async () => {
  const answers = [
    "https://awareness.market/mcp",
    "aw_test",
    "mem_123",
  ];
  const asked = [];

  const result = await cliModule.resolveMcpConfigInputs({
    argv: ["--configure-mcp"],
    ideId: "copilot",
    isInteractive: true,
    prompt: async (question) => {
      asked.push(question);
      return answers.shift() ?? "";
    },
  });

  assert.equal(result.shouldSync, true);
  assert.equal(result.mcpUrl, "https://awareness.market/mcp");
  assert.equal(result.apiKey, "aw_test");
  assert.equal(result.memoryId, "mem_123");
  assert.deepEqual(asked, [
    "Awareness MCP URL: ",
    "Awareness API key: ",
    "Awareness Memory ID: ",
  ]);
});

test("CLI can dry-run rule sync plus MCP config sync", async () => {
  const cwd = makeTempDir();
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
    const exitCode = await cliModule.main([
      "--ide",
      "copilot",
      "--dry-run",
      "--mcp-url",
      "https://awareness.market/mcp",
      "--api-key",
      "aw_test",
      "--memory-id",
      "mem_123",
    ]);

    assert.equal(exitCode, 0);
    assert.equal(fs.existsSync(path.join(cwd, ".github", "copilot-instructions.md")), false);
    assert.equal(fs.existsSync(path.join(cwd, ".vscode", "mcp.json")), false);
  } finally {
    process.chdir(originalCwd);
  }
});

test("normalizeIdeId accepts GitHub Copilot aliases", () => {
  assert.equal(rulesModule.normalizeIdeId("copilot"), "copilot");
  assert.equal(rulesModule.normalizeIdeId("github-copilot"), "copilot");
  assert.equal(rulesModule.normalizeIdeId("vscode-copilot"), "copilot");
});

test("getIdeMcpPath returns file-based config path for copilot", () => {
  assert.equal(rulesModule.getIdeMcpPath("copilot"), ".vscode/mcp.json");
});
