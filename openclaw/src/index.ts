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

  // On every session start: auto-initiate device auth and inject the URL directly
  // into system context so the agent presents it without any tool call needed.
  api.on(
    "before_agent_start",
    async (_context: unknown): Promise<HookResult | void> => {
      // Check if a fresh device auth was already started this session
      // (cache file may exist from a previous approval attempt)
      if (fs.existsSync(AUTH_CACHE_FILE)) {
        try {
          const cached = JSON.parse(fs.readFileSync(AUTH_CACHE_FILE, "utf8")) as Record<string, unknown>;
          if (cached.status === "approved" && cached.apiKey) {
            // Auth completed — poll-auth.js already patched openclaw.json
            try { fs.unlinkSync(AUTH_CACHE_FILE); } catch { /* ok */ }
            return {
              prependSystemContext:
                "[Awareness Memory] Setup complete! Your account has been linked. " +
                "Please restart this session to activate memory integration.",
            };
          }
        } catch { /* continue to start fresh auth */ }
      }

      // Auto-start device auth — user just needs to click the link
      api.logger.info("[awareness] before_agent_start hook fired — auto-starting device auth");
      try {
        const resp = await fetch(`${baseUrl}/auth/device/init`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: "openclaw-plugin" }),
          signal: AbortSignal.timeout(6000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as Record<string, unknown>;
          const deviceCode = String(data.device_code ?? "");
          const userCode = String(data.user_code ?? "");
          const verificationUriBase = String(data.verification_uri ?? "https://awareness.market/cli-auth");
          const authUrl = `${verificationUriBase}?code=${encodeURIComponent(userCode)}`;
          const intervalSec = Number(data.interval ?? 5);
          const expiresIn = Number(data.expires_in ?? 600);

          if (deviceCode) {
            // Spawn background poller
            const { spawn } = await import("child_process");
            const scriptCandidates = [
              path.join(__dirname, "poll-auth.js"),
              path.join(__dirname, "..", "dist", "poll-auth.js"),
            ];
            const pollScript = scriptCandidates.find(p => { try { return fs.existsSync(p); } catch { return false; } }) ?? scriptCandidates[0];
            const child = spawn(process.execPath, [pollScript, deviceCode, baseUrl, String(intervalSec), String(expiresIn)], {
              detached: true,
              stdio: "ignore",
            });
            child.unref();

            return {
              prependSystemContext:
                `<awareness-memory>\n` +
                `  <setup-required>\n` +
                `    Memory is not configured. You MUST tell the user this exact message FIRST, before answering:\n` +
                `    "To enable memory, please open this link (~30 sec): ${authUrl}"\n` +
                `    After giving the link, answer their question normally.\n` +
                `  </setup-required>\n` +
                `</awareness-memory>`,
            };
          }
        }
      } catch { /* network error — fall back to static hint */ }

      // Fallback: static hint if device auth init fails
      return {
        prependSystemContext:
          `<awareness-memory>\n` +
          `  <setup-required>Memory not configured. Tell user: call awareness_setup(action='start_auth') to get a login link.</setup-required>\n` +
          `</awareness-memory>`,
      };
    },
  );

  api.logger.warn(
    "Awareness memory plugin loaded in setup mode — no local daemon and no cloud credentials. " +
      "Auto-initiating device auth on next session start.",
  );
}

// ---------------------------------------------------------------------------
// Background daemon health-check + auto-start (non-blocking)
// ---------------------------------------------------------------------------

async function ensureLocalDaemon(
  api: PluginApi,
  localUrl: string,
  termux: boolean,
): Promise<boolean> {
  // Quick health check
  try {
    const healthResp = await fetch(`${localUrl}/healthz`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    if (healthResp.ok) return true;
  } catch {
    // Not reachable — try auto-start below
  }

  if (termux) {
    api.logger.info("Termux/Android detected — skipping local daemon auto-start");
    return false;
  }

  // Daemon not reachable — try to auto-start it (desktop only)
  api.logger.info("Local daemon not running, attempting auto-start...");
  try {
    const { spawn } = await import("child_process");
    const child = spawn("npx", ["-y", "@awareness-sdk/local", "start"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    // Poll healthz for up to 8 seconds
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const retry = await fetch(`${localUrl}/healthz`, {
          method: "GET",
          signal: AbortSignal.timeout(1000),
        });
        if (retry.ok) {
          api.logger.info("Local daemon auto-started successfully");
          return true;
        }
      } catch {
        // Keep polling
      }
    }
  } catch {
    // npx/spawn not available
  }

  api.logger.warn("Local daemon auto-start timed out");
  return false;
}

// ---------------------------------------------------------------------------
// Plugin entry point — MUST be synchronous (OpenClaw ignores async register)
// ---------------------------------------------------------------------------

export default function register(api: PluginApi): void {
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
  // Priority 1: Cloud mode — can be determined synchronously
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

    importOpenClawHistory(client, api.logger).catch(() => {});
    return;
  }

  // ---------------------------------------------------------------------------
  // Priority 2: Local daemon mode — register tools/hooks immediately,
  // check daemon availability in background (non-blocking)
  // ---------------------------------------------------------------------------
  const client = new AwarenessClient(
    `${localUrl}/api/v1`,
    "",
    config.memoryId || "local",
    config.agentRole,
  );

  registerTools(api, client);
  registerHooks(api, client, config);

  api.logger.info(
    `Awareness memory plugin registered — ` +
      `url=${localUrl}, role=${config.agentRole}, ` +
      `autoRecall=${config.autoRecall}, autoCapture=${config.autoCapture}`,
  );

  // Background: verify daemon is running, auto-start if needed
  const termux = isTermux();
  ensureLocalDaemon(api, localUrl, termux)
    .then((running) => {
      if (running) {
        api.logger.info(
          `Awareness memory plugin initialized (local daemon) — ` +
            `url=${localUrl}, role=${config.agentRole}`,
        );
        importOpenClawHistory(client, api.logger).catch(() => {});
      } else if (!config.apiKey) {
        // No daemon and no cloud creds — register setup mode as fallback
        registerSetupMode(api, config.baseUrl);
      }
    })
    .catch(() => {
      if (!config.apiKey) {
        registerSetupMode(api, config.baseUrl);
      }
    });
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
