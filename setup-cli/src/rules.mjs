import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve spec.json: bundled copy (npm publish) or repo root (dev)
const BUNDLED_SPEC = new URL("../ide-rules.spec.json", import.meta.url);
const REPO_SPEC = new URL("../../../ide-rules.spec.json", import.meta.url);
const SPEC_URL = existsSync(fileURLToPath(BUNDLED_SPEC)) ? BUNDLED_SPEC : REPO_SPEC;

const IDE_ALIASES = {
  "claude-code": "claude-code",
  claude: "claude-code",
  claudecode: "claude-code",
  claude_code: "claude-code",
  cursor: "cursor",
  windsurf: "windsurf",
  cline: "cline",
  copilot: "copilot",
  githubcopilot: "copilot",
  "github-copilot": "copilot",
  vscodecopilot: "copilot",
  "vscode-copilot": "copilot",
  codex: "codex",
  opencode: "codex",
  kiro: "kiro",
  trae: "trae",
  zed: "zed",
  jetbrains: "jetbrains",
  junie: "jetbrains",
  intellij: "jetbrains",
  augment: "augment",
  antigravity: "antigravity",
  "google-antigravity": "antigravity",
};

let specCache = null;

const MCP_PATHS = {
  cursor: ".cursor/mcp.json",
  "claude-code": ".claude/settings.json",
  windsurf: ".windsurf/mcp.json",
  copilot: ".vscode/mcp.json",
  kiro: ".kiro/settings/mcp.json",
  trae: ".mcp.json",
  jetbrains: ".junie/mcp/mcp.json",
};

export function loadRulesSpec() {
  if (!specCache) {
    specCache = JSON.parse(readFileSync(SPEC_URL, "utf-8"));
  }
  return specCache;
}

export function getMarkers() {
  const spec = loadRulesSpec();
  return {
    start: String(spec.markers?.start ?? ""),
    end: String(spec.markers?.end ?? ""),
  };
}

export function normalizeIdeId(rawIde) {
  const normalized = String(rawIde ?? "").trim().toLowerCase().replaceAll(" ", "-");
  return IDE_ALIASES[normalized] ?? null;
}

export function getSupportedIdeIds() {
  const spec = loadRulesSpec();
  const ids = Array.isArray(spec.ide_order) ? spec.ide_order : Object.keys(spec.ides ?? {});
  return ids.filter((id) => typeof id === "string" && id in (spec.ides ?? {}));
}

export function getIdeConfig(ideId) {
  const normalizedIde = normalizeIdeId(ideId);
  if (!normalizedIde) {
    return null;
  }
  const spec = loadRulesSpec();
  const config = spec.ides?.[normalizedIde];
  return config && typeof config === "object" ? { id: normalizedIde, ...config } : null;
}

export function getIdeMcpPath(ideId) {
  const normalizedIde = normalizeIdeId(ideId);
  if (!normalizedIde) {
    return null;
  }
  return MCP_PATHS[normalizedIde] ?? null;
}

export function renderUniversalRule(source = "<tool_name>") {
  const spec = loadRulesSpec();
  return renderCore(spec, source || "<tool_name>");
}

export function renderIdeRule(ideId, source = "") {
  const config = getIdeConfig(ideId);
  if (!config) {
    throw new Error(`Unknown IDE: ${ideId}`);
  }

  const spec = loadRulesSpec();
  const markers = getMarkers();
  const sections = [
    String(config.header ?? ""),
    ...cleanLines(config.preamble_lines),
    renderCore(spec, source || config.id),
    ...cleanLines(config.notes_lines),
  ];
  const managedBlock = joinSections(sections);

  if (config.frontmatter && typeof config.frontmatter === "object") {
    return `${renderFrontmatter(config.frontmatter)}\n\n${markers.start}\n${managedBlock}\n${markers.end}\n`;
  }
  return `${markers.start}\n${managedBlock}\n${markers.end}\n`;
}

export function autoDetectIde(cwd = process.cwd(), env = process.env) {
  const checks = {
    cursor: () => existsSync(join(cwd, ".cursor")) || existsSync(join(cwd, ".cursor", "rules")),
    "claude-code": () => existsSync(join(cwd, "CLAUDE.md")) || Boolean(env.CLAUDE_CODE),
    windsurf: () => existsSync(join(cwd, ".windsurfrules")),
    cline: () => existsSync(join(cwd, ".clinerules")),
    copilot: () => existsSync(join(cwd, ".github", "copilot-instructions.md")) || existsSync(join(cwd, ".vscode", "mcp.json")),
    codex: () => existsSync(join(cwd, "AGENTS.md")),
    kiro: () => existsSync(join(cwd, ".kiro")),
    trae: () => existsSync(join(cwd, ".trae")),
    zed: () => existsSync(join(cwd, ".rules")),
    jetbrains: () => existsSync(join(cwd, ".junie")),
    augment: () => existsSync(join(cwd, ".augment")),
    antigravity: () => existsSync(join(cwd, ".antigravity")),
  };

  for (const ideId of getSupportedIdeIds()) {
    if (checks[ideId]?.()) {
      return ideId;
    }
  }
  return null;
}

export function inspectMarkers(text, startMarker, endMarker) {
  const startCount = countOccurrences(text, startMarker);
  const endCount = countOccurrences(text, endMarker);
  if (startCount === 0 && endCount === 0) {
    return { status: "absent" };
  }
  if (startCount !== 1 || endCount !== 1) {
    return { status: "conflict", reason: "expected exactly one start marker and one end marker" };
  }

  const startIndex = text.indexOf(startMarker);
  const endIndex = text.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    return { status: "conflict", reason: "Awareness markers are malformed or out of order" };
  }

  let replaceEnd = endIndex + endMarker.length;
  if (text.startsWith("\r\n", replaceEnd)) {
    replaceEnd += 2;
  } else if (text.startsWith("\n", replaceEnd)) {
    replaceEnd += 1;
  }

  return {
    status: "valid",
    startIndex,
    replaceEnd,
  };
}

export function syncManagedBlockText(existingText, managedBlock, markers = getMarkers()) {
  if (existingText == null) {
    return { action: "create", content: managedBlock };
  }

  const state = inspectMarkers(existingText, markers.start, markers.end);
  if (state.status === "absent") {
    return { action: "append", content: appendManagedBlock(existingText, managedBlock) };
  }
  if (state.status === "conflict") {
    return { action: "conflict", reason: state.reason, content: existingText };
  }

  const nextText = `${existingText.slice(0, state.startIndex)}${managedBlock}${existingText.slice(state.replaceEnd)}`;
  return { action: nextText === existingText ? "noop" : "replace", content: nextText };
}

export function syncManagedFileText(existingText, renderedFile, options = {}) {
  const markers = options.markers ?? getMarkers();
  const force = Boolean(options.force);
  if (existingText == null) {
    return { action: "create", content: renderedFile };
  }

  const state = inspectMarkers(existingText, markers.start, markers.end);
  if (state.status === "valid") {
    return { action: existingText === renderedFile ? "noop" : "replace", content: renderedFile };
  }
  if (state.status === "conflict") {
    return { action: "conflict", reason: state.reason, content: existingText };
  }
  if (force) {
    return { action: existingText === renderedFile ? "noop" : "replace", content: renderedFile };
  }
  return {
    action: "conflict",
    reason: "managed_file already exists without Awareness markers",
    content: existingText,
  };
}

export function syncIdeRules(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const ideId = normalizeIdeId(options.ideId);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);

  const config = getIdeConfig(ideId);
  if (!config) {
    throw new Error(`Unknown IDE: ${options.ideId}`);
  }

  const fullPath = join(cwd, config.rules_file);
  const existingText = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : null;
  const rendered = renderIdeRule(config.id, config.id);
  const markers = getMarkers();
  const result =
    config.strategy === "managed_file"
      ? syncManagedFileText(existingText, rendered, { force, markers })
      : syncManagedBlockText(existingText, rendered, markers);

  if (result.action === "conflict") {
    return {
      ok: false,
      ...result,
      ideId: config.id,
      filePath: config.rules_file,
      fullPath,
      strategy: config.strategy,
      conflictPolicy: config.conflict_policy,
    };
  }

  if (!dryRun && result.action !== "noop") {
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, result.content, "utf-8");
  }

  return {
    ok: true,
    ...result,
    ideId: config.id,
    filePath: config.rules_file,
    fullPath,
    strategy: config.strategy,
    conflictPolicy: config.conflict_policy,
    dryRun,
  };
}

export function buildMcpServerConfig(options = {}) {
  const serverName = String(options.serverName || "awareness-memory").trim() || "awareness-memory";
  const mcpUrl = String(options.mcpUrl || "").trim();
  const apiKey = String(options.apiKey || "").trim();
  const memoryId = String(options.memoryId || "").trim();
  const agentRole = String(options.agentRole || "builder_agent").trim() || "builder_agent";

  if (!mcpUrl || !apiKey || !memoryId) {
    throw new Error("mcpUrl, apiKey, and memoryId are required to build MCP config");
  }

  return {
    mcpServers: {
      [serverName]: {
        url: mcpUrl,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Awareness-Memory-Id": memoryId,
          "X-Awareness-Agent-Role": agentRole,
        },
      },
    },
  };
}

export function mergeMcpConfigText(existingText, nextServerConfig) {
  let base = {};
  if (existingText != null) {
    try {
      base = JSON.parse(existingText);
    } catch {
      return {
        action: "conflict",
        reason: "existing MCP config is not valid JSON",
        content: existingText,
      };
    }
  }

  const currentServers =
    base && typeof base === "object" && base.mcpServers && typeof base.mcpServers === "object"
      ? base.mcpServers
      : {};
  const nextServers = nextServerConfig.mcpServers ?? {};
  const merged = {
    ...(base && typeof base === "object" ? base : {}),
    mcpServers: {
      ...currentServers,
      ...nextServers,
    },
  };
  const rendered = `${JSON.stringify(merged, null, 2)}\n`;
  return {
    action: existingText == null ? "create" : rendered === existingText ? "noop" : "replace",
    content: rendered,
  };
}

export function syncIdeMcpConfig(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const ideId = normalizeIdeId(options.ideId);
  const dryRun = Boolean(options.dryRun);
  const filePath = getIdeMcpPath(ideId);

  if (!ideId) {
    throw new Error(`Unknown IDE: ${options.ideId}`);
  }
  if (!filePath) {
    return {
      ok: false,
      action: "unsupported",
      reason: `IDE ${ideId} does not have a file-based MCP config path`,
      ideId,
      filePath: null,
      fullPath: null,
      dryRun,
    };
  }

  const fullPath = join(cwd, filePath);
  const existingText = existsSync(fullPath) ? readFileSync(fullPath, "utf-8") : null;
  const nextConfig = buildMcpServerConfig(options);
  const result = mergeMcpConfigText(existingText, nextConfig);

  if (result.action === "conflict") {
    return {
      ok: false,
      ...result,
      ideId,
      filePath,
      fullPath,
      dryRun,
    };
  }

  if (!dryRun && result.action !== "noop") {
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, result.content, "utf-8");
  }

  return {
    ok: true,
    ...result,
    ideId,
    filePath,
    fullPath,
    dryRun,
  };
}

function renderCore(spec, source) {
  const lines = Array.isArray(spec.core_lines) ? spec.core_lines : [];
  return lines.map((line) => String(line).replaceAll("{source}", source)).join("\n").trim();
}

function cleanLines(rawLines) {
  if (!Array.isArray(rawLines)) {
    return [];
  }
  return rawLines.map((line) => String(line)).filter((line) => line.length > 0);
}

function joinSections(sections) {
  return sections
    .map((section) => String(section ?? "").replace(/\n+$/g, "").replace(/^\n+/g, ""))
    .filter((section) => section.length > 0)
    .join("\n\n")
    .trim();
}

function renderFrontmatter(frontmatter) {
  const lines = ["---"];
  for (const key of ["description", "globs", "alwaysApply"]) {
    if (!(key in frontmatter)) {
      continue;
    }
    const value = frontmatter[key];
    const rendered = value === true ? "true" : value === false ? "false" : String(value);
    lines.push(`${key}: ${rendered}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function appendManagedBlock(existingText, managedBlock) {
  if (!existingText) {
    return managedBlock;
  }
  const trimmed = existingText.replace(/[\r\n]+$/g, "");
  if (!trimmed) {
    return managedBlock;
  }
  return `${trimmed}\n\n${managedBlock}`;
}

function countOccurrences(text, marker) {
  let count = 0;
  let startIndex = 0;
  while (true) {
    const index = text.indexOf(marker, startIndex);
    if (index === -1) {
      return count;
    }
    count += 1;
    startIndex = index + marker.length;
  }
}
