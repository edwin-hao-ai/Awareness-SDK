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

test("CLI dry-run previews changes without writing files", () => {
  const cwd = makeTempDir();
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
    const exitCode = cliModule.main(["--ide", "codex", "--dry-run"]);

    assert.equal(exitCode, 0);
    assert.equal(fs.existsSync(path.join(cwd, "AGENTS.md")), false);
  } finally {
    process.chdir(originalCwd);
  }
});
