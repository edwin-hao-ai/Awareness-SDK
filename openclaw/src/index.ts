import * as fs from "fs";
import * as path from "path";
import type { PluginApi, PluginConfig, HookContext, HookResult } from "./types";
import { AwarenessClient } from "./client";
import { registerTools } from "./tools";
import { registerHooks } from "./hooks";
import { importOpenClawHistory } from "./sync";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOME = process.env.HOME || process.env.USERPROFILE || "";
const AUTH_CACHE_FILE = path.join(HOME, ".awareness", "device-auth-result.json");
const DEFAULT_BASE_URL = "https://awareness.market/api/v1";

// ---------------------------------------------------------------------------
// Termux / Android detection
// ---------------------------------------------------------------------------

function isTermux(): boolean {
  return (
    Boolean(process.env.TERMUX_VERSION) ||
    (typeof process.env.PREFIX === "string" && process.env.PREFIX.includes("com.termux"))
  );
}

// ---------------------------------------------------------------------------
// Setup-only mode — registered when credentials are missing
// ---------------------------------------------------------------------------

function registerSetupMode(api: PluginApi, baseUrl: string = DEFAULT_BASE_URL): void {
  // Provide a tool that returns setup instructions or starts device auth
  api.registerTool({
    id: "awareness_setup",
    name: "awareness_setup",
    description:
      "Awareness Memory is not configured yet. " +
      "Call with action='start_auth' to start a mobile-friendly device auth flow (no manual config editing needed). " +
      "Call with action='check_auth' to check if auth was approved. " +
      "Or call with no arguments for full setup instructions.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "'start_auth' to begin device auth flow, 'check_auth' to check auth status, omit for setup instructions",
          enum: ["start_auth", "check_auth"],
        },
        format: {
          type: "string",
          description: "Output format: 'text' (default) or 'json'",
          enum: ["text", "json"],
        },
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const action = args.action as string | undefined;

      // --- Device auth: start ---
      if (action === "start_auth") {
        try {
          const resp = await fetch(`${baseUrl}/auth/device/init`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: "openclaw-plugin" }),
            signal: AbortSignal.timeout(10000),
          });
          if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            return { status: "error", message: `Device auth init failed: ${resp.status} ${text}` };
          }
          const data = (await resp.json()) as Record<string, unknown>;
          const deviceCode = String(data.device_code ?? "");
          const userCode = String(data.user_code ?? "");
          const verificationUriBase = String(data.verification_uri ?? "https://awareness.market/cli-auth");
          // Append ?code= so the page auto-fills the input (avoids "Missing Code" error)
          const verificationUri = `${verificationUriBase}?code=${encodeURIComponent(userCode)}`;
          const intervalSec = Number(data.interval ?? 5);
          const expiresIn = Number(data.expires_in ?? 600);

          if (!deviceCode) {
            return { status: "error", message: "No device_code returned from server" };
          }

          // Spawn poll-auth.js as detached background process
          const { spawn } = await import("child_process");
          // Prefer compiled poll-auth.js next to this file, then fall back to ts-node source
          const scriptCandidates = [
            path.join(__dirname, "poll-auth.js"),
            path.join(__dirname, "..", "dist", "poll-auth.js"),
          ];
          const pollScript = scriptCandidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) ?? scriptCandidates[0];

          const child = spawn(process.execPath, [
            pollScript,
            deviceCode,
            baseUrl,
            String(intervalSec),
            String(expiresIn),
          ], {
            detached: true,
            stdio: "ignore",
          });
          child.unref();

          return {
            status: "pending",
            auth_url: verificationUri,
            user_code: userCode,
            expires_in_seconds: expiresIn,
            message:
              `Device auth started. Please visit: ${verificationUri}\n` +
              `Enter code: ${userCode}\n` +
              `Authorization will be checked in the background. ` +
              `Call awareness_setup(action='check_auth') after visiting the URL to confirm.`,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { status: "error", message: `Device auth start failed: ${msg}` };
        }
      }

      // --- Device auth: check ---
      if (action === "check_auth") {
        try {
          if (!fs.existsSync(AUTH_CACHE_FILE)) {
            return {
              status: "pending",
              message: "No auth result yet. Start auth first with action='start_auth', then visit the URL shown.",
            };
          }
          const cached = JSON.parse(fs.readFileSync(AUTH_CACHE_FILE, "utf8")) as Record<string, unknown>;
          if (cached.status === "approved") {
            // Clean up cache file
            try { fs.unlinkSync(AUTH_CACHE_FILE); } catch { /* ok */ }
            return {
              status: "approved",
              message:
                "Awareness Memory is now configured! Your credentials have been saved to ~/.openclaw/openclaw.json. " +
                "Restart OpenClaw (or the current session) to activate memory integration.",
            };
          }
          if (cached.status === "failed") {
            return {
              status: "failed",
              reason: String(cached.reason ?? "unknown"),
              message: `Auth failed: ${cached.reason ?? "unknown"}. Start again with action='start_auth'.`,
            };
          }
          // Still pending (poll-auth still running)
          return {
            status: "pending",
            message: "Auth not yet approved. Please visit the URL shown earlier and enter the code, then call check_auth again.",
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { status: "error", message: `Failed to check auth status: ${msg}` };
        }
      }

      // --- Default: setup instructions ---
      return {
        status: "not_configured",
        message: "Awareness Memory plugin needs either a local daemon or cloud credentials to work.",
        setup_options: [
          {
            method: "Device auth (mobile/Android friendly — no manual config editing)",
            steps: [
              "1. Call awareness_setup(action='start_auth')",
              "2. Visit the URL shown and enter the user code",
              "3. Call awareness_setup(action='check_auth') to confirm",
            ],
          },
          {
            method: "Local daemon (recommended for privacy on desktop)",
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
      };
    },
  });

  // Inject a hint into every session so the agent knows memory is unavailable
  api.registerHook(
    "before_agent_start",
    async (_context: HookContext): Promise<HookResult | void> => ({
      prependSystemContext:
        "[Awareness Memory] Not configured — cloud credentials needed. " +
        "Call awareness_setup(action='start_auth') for a device auth flow (works on mobile/Android too — no manual config editing). " +
        "Or call awareness_setup() for all setup options.",
    }),
    { priority: 10 },
  );

  api.logger.warn(
    "Awareness memory plugin loaded in setup mode — no local daemon and no cloud credentials. " +
      "Call awareness_setup tool or run `npx @awareness-sdk/setup --ide openclaw` to complete setup.",
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
  // Priority 1: Check local daemon (auto-start if not running, skip on Termux/Android)
  // ---------------------------------------------------------------------------
  let localDaemonRunning = false;
  const termux = isTermux();
  if (termux) {
    api.logger.info("Termux/Android detected — skipping local daemon auto-start (not supported on Android)");
  }
  try {
    const healthResp = await fetch(`${localUrl}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    localDaemonRunning = healthResp.ok;
  } catch {
    if (!termux) {
      // Daemon not reachable — try to auto-start it (desktop only)
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

    // Fire-and-forget: import OpenClaw history on first install
    importOpenClawHistory(client, api.logger).catch(() => {});
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

    // Fire-and-forget: import OpenClaw history on first install
    importOpenClawHistory(client, api.logger).catch(() => {});
    return;
  }

  // ---------------------------------------------------------------------------
  // Priority 3: No daemon, no cloud credentials → setup mode
  // ---------------------------------------------------------------------------
  registerSetupMode(api, config.baseUrl);
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
