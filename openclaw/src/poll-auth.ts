/**
 * poll-auth.ts — Background device auth polling process.
 *
 * Spawned detached by awareness_setup after device/init.
 * Polls /auth/device/poll until approved or expired,
 * then writes apiKey + memoryId to ~/.openclaw/openclaw.json.
 *
 * Usage: node poll-auth.js <device_code> <base_url> <interval> <expires_in>
 */

import * as fs from "fs";
import * as path from "path";

const OPENCLAW_CONFIG_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".openclaw",
  "openclaw.json",
);
const AUTH_CACHE_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".awareness",
  "device-auth-result.json",
);

async function poll(
  baseUrl: string,
  deviceCode: string,
  intervalMs: number,
  expiresAt: number,
): Promise<void> {
  while (Date.now() < expiresAt) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const resp = await fetch(`${baseUrl}/auth/device/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
        signal: AbortSignal.timeout(8000),
      });
      const data = (await resp.json()) as Record<string, unknown>;

      if (data.status === "approved" && data.api_key) {
        const apiKey = String(data.api_key);

        // Fetch memories to pick the first one (or create a default)
        let memoryId = "";
        try {
          const memResp = await fetch(`${baseUrl}/memories`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(8000),
          });
          const memData = await memResp.json();
          // API returns either an array directly or { memories: [...] }
          const memories = Array.isArray(memData) ? memData : (Array.isArray(memData.memories) ? memData.memories : []);
          if (memories.length > 0) {
            memoryId = String((memories[0] as Record<string, unknown>).id ?? "");
          }
        } catch { /* best-effort */ }

        // Write result to cache file for awareness_setup check action to read
        const cacheDir = path.dirname(AUTH_CACHE_FILE);
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(
          AUTH_CACHE_FILE,
          JSON.stringify({ status: "approved", apiKey, memoryId, ts: Date.now() }),
          "utf8",
        );

        // Write config to ~/.openclaw/openclaw.json
        patchOpenClawConfig(apiKey, memoryId);
        return;
      }

      if (data.status === "expired") {
        writeFailure("expired");
        return;
      }
      // status === "pending" → keep polling
    } catch {
      // Network error — keep polling
    }
  }
  writeFailure("timeout");
}

function writeFailure(reason: string): void {
  try {
    const cacheDir = path.dirname(AUTH_CACHE_FILE);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      AUTH_CACHE_FILE,
      JSON.stringify({ status: "failed", reason, ts: Date.now() }),
      "utf8",
    );
  } catch { /* best-effort */ }
}

function patchOpenClawConfig(apiKey: string, memoryId: string): void {
  try {
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, "utf8")); } catch { /* new file */ }

    // Navigate to plugins.entries.openclaw-memory.config and set credentials
    const plugins = (cfg.plugins ?? {}) as Record<string, unknown>;
    const entries = (plugins.entries ?? {}) as Record<string, unknown>;
    const pluginEntry = (entries["openclaw-memory"] ?? {}) as Record<string, unknown>;
    const pluginConfig = (pluginEntry.config ?? {}) as Record<string, unknown>;

    pluginConfig.apiKey = apiKey;
    if (memoryId) pluginConfig.memoryId = memoryId;

    pluginEntry.config = pluginConfig;
    entries["openclaw-memory"] = pluginEntry;
    plugins.entries = entries;
    cfg.plugins = plugins;

    fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(cfg, null, 4), "utf8");
  } catch { /* best-effort */ }
}

// Entry point
const [, , deviceCode, baseUrl, intervalStr, expiresInStr] = process.argv;
if (!deviceCode || !baseUrl) {
  process.exit(1);
}
const intervalMs = (Number(intervalStr) || 5) * 1000;
const expiresIn = Number(expiresInStr) || 600;
const expiresAt = Date.now() + expiresIn * 1000;

poll(baseUrl, deviceCode, intervalMs, expiresAt).catch(() => writeFailure("error"));
