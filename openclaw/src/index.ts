import type { PluginApi, PluginConfig, HookContext, HookResult } from "./types";
import { AwarenessClient } from "./client";
import { registerTools } from "./tools";
import { registerHooks } from "./hooks";

// ---------------------------------------------------------------------------
// Setup-only mode — registered when credentials are missing
// ---------------------------------------------------------------------------

function registerSetupMode(api: PluginApi): void {
  // Provide a tool that returns setup instructions
  api.registerTool({
    id: "awareness_setup",
    name: "awareness_setup",
    description:
      "Awareness Memory is not configured yet. Call this tool to get setup instructions.\n" +
      "Quickest way: `openclaw plugins install @awareness-sdk/openclaw-memory` or `npx clawhub@latest install awareness-memory`.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          description: "Output format: 'text' (default) or 'json'",
          enum: ["text", "json"],
        },
      },
    },
    execute: async () => ({
      status: "not_configured",
      message: "Awareness Memory plugin needs either a local daemon or cloud credentials to work.",
      setup_options: [
        {
          method: "Local daemon (recommended for privacy)",
          command: "npx @awareness-sdk/local start",
          description:
            "Start a local Awareness daemon. Memory stays on your machine. No account needed.",
        },
        {
          method: "One-command cloud setup",
          command: "npx @awareness-sdk/setup --ide openclaw",
          description:
            "Opens browser for login, lets you pick a memory, and writes config automatically.",
        },
        {
          method: "Install as skill (via ClawHub)",
          command: "npx clawhub@latest install awareness-memory",
          description:
            "Lightweight skill-based integration. Configure API key and memory ID after install.",
        },
        {
          method: "Manual cloud configuration",
          steps: [
            "1. Sign up or log in at https://awareness.market",
            "2. Copy your API key (starts with aw_) from Settings",
            "3. Copy your Memory ID from the memory detail page",
            '4. Edit ~/.openclaw/openclaw.json → plugins.entries["openclaw-memory"].config',
            "5. Set apiKey and memoryId, then restart OpenClaw",
          ],
        },
      ],
    }),
  });

  // Inject a hint into every session so the agent knows memory is unavailable
  api.registerHook(
    "before_agent_start",
    async (_context: HookContext): Promise<HookResult | void> => ({
      prependSystemContext:
        "[Awareness Memory] Not configured yet. " +
        "Install: `openclaw plugins install @awareness-sdk/openclaw-memory` or `npx clawhub@latest install awareness-memory`. " +
        "For local-first: `npx @awareness-sdk/local start`. " +
        "Call the awareness_setup tool for detailed instructions.",
    }),
    { priority: 10 },
  );

  api.logger.warn(
    "Awareness memory plugin loaded in setup mode — no local daemon and no cloud credentials. " +
      "Run `openclaw plugins install @awareness-sdk/openclaw-memory` or `npx clawhub@latest install awareness-memory` to complete setup.",
  );
}

// ---------------------------------------------------------------------------
// Plugin entry point — called by the OpenClaw host to initialize the plugin
// ---------------------------------------------------------------------------

export default async function register(api: PluginApi): Promise<void> {
  // OpenClaw host may expose plugin-specific config as `pluginConfig`
  // while `config` can be the entire openclaw.json. Try pluginConfig first.
  const raw: Record<string, unknown> = api.pluginConfig ?? api.config ?? {};

  // Resolve config with defaults matching openclaw.plugin.json configSchema
  const config: PluginConfig = {
    apiKey: String(raw.apiKey ?? ""),
    baseUrl: String(raw.baseUrl ?? "https://awareness.market/api/v1"),
    memoryId: String(raw.memoryId ?? ""),
    agentRole: String(raw.agentRole ?? "builder_agent"),
    autoRecall: raw.autoRecall !== undefined ? Boolean(raw.autoRecall) : true,
    autoCapture: raw.autoCapture !== undefined ? Boolean(raw.autoCapture) : true,
    recallLimit: raw.recallLimit !== undefined ? Number(raw.recallLimit) : 8,
    localUrl: String(raw.localUrl ?? "http://localhost:37800"),
    embeddingLanguage: (raw.embeddingLanguage === "multilingual" ? "multilingual" : "english") as PluginConfig["embeddingLanguage"],
  };

  const localUrl = config.localUrl;

  // ---------------------------------------------------------------------------
  // Priority 1: Check local daemon (auto-start if not running)
  // ---------------------------------------------------------------------------
  let localDaemonRunning = false;
  try {
    const healthResp = await fetch(`${localUrl}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    localDaemonRunning = healthResp.ok;
  } catch {
    // Daemon not reachable — try to auto-start it
    api.logger.info("Local daemon not running, attempting auto-start...");
    try {
      // AUDIT FIX: Use spawn+detached instead of exec (exec kills daemon after timeout)
      const { spawn } = await import("child_process");
      const child = spawn("npx", ["-y", "@awareness-sdk/local", "start"], {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      // Wait for daemon to be ready (poll healthz for up to 8 seconds)
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const retry = await fetch(`${localUrl}/healthz`, {
            method: "GET",
            signal: AbortSignal.timeout(1000),
          });
          if (retry.ok) {
            localDaemonRunning = true;
            api.logger.info("Local daemon auto-started successfully");
            break;
          }
        } catch {
          // Keep polling
        }
      }
      if (!localDaemonRunning) {
        api.logger.warn("Auto-start timed out — falling back to cloud or setup mode");
      }
    } catch {
      // npx/spawn not available or other error — fall through silently
    }
  }

  if (localDaemonRunning) {
    // Local daemon is running — use it without auth headers
    const client = new AwarenessClient(
      `${localUrl}/api/v1`,
      "", // No API key needed for local daemon
      config.memoryId || "local", // memoryId may be empty for local
      config.agentRole,
    );

    registerTools(api, client);
    registerHooks(api, client, config);

    api.logger.info(
      `Awareness memory plugin initialized (local daemon) — ` +
        `url=${localUrl}, role=${config.agentRole}, ` +
        `autoRecall=${config.autoRecall}, autoCapture=${config.autoCapture}`,
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // Priority 2: Cloud mode — requires apiKey and memoryId
  // ---------------------------------------------------------------------------
  if (config.apiKey && config.memoryId) {
    const client = new AwarenessClient(
      config.baseUrl,
      config.apiKey,
      config.memoryId,
      config.agentRole,
    );

    registerTools(api, client);
    registerHooks(api, client, config);

    api.logger.info(
      `Awareness memory plugin initialized (cloud) — ` +
        `memory=${config.memoryId}, role=${config.agentRole}, ` +
        `autoRecall=${config.autoRecall}, autoCapture=${config.autoCapture}`,
    );
    return;
  }

  // ---------------------------------------------------------------------------
  // Priority 3: No daemon, no cloud credentials → setup mode
  // ---------------------------------------------------------------------------
  registerSetupMode(api);
}

// Re-export types and client for programmatic usage
export { AwarenessClient } from "./client";
export { registerTools } from "./tools";
export { registerHooks } from "./hooks";
export type { SearchOptions } from "./client";
export type {
  PluginApi,
  PluginConfig,
  PluginLogger,
  ToolDefinition,
  HookHandler,
  HookOptions,
  HookContext,
  HookMessage,
  HookResult,
  VectorResult,
  RecallResult,
  SessionContext,
  KnowledgeCard,
  ActionItem,
  Risk,
  IngestResponse,
  KnowledgeBaseResponse,
  ActionItemsResponse,
  RisksResponse,
  SupersedeResponse,
} from "./types";
