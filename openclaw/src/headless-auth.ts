/**
 * headless-auth.ts — Shared UX helper for RFC 8628 device code flow in
 * headless / remote / no-browser environments.
 *
 * Zero external dependencies. Node builtins only.
 *
 * IMPORTANT: This file is copy-pasted into 4 independently-published packages:
 *   - sdks/setup-cli/src/headless-auth.mjs
 *   - sdks/awareness-memory/scripts/headless-auth.js
 *   - sdks/claudecode/scripts/headless-auth.js
 *   - sdks/openclaw/src/headless-auth.ts             (this file)
 *
 * If you change one, sync the other three. See docs/features/f-035/.
 */

import { execSync } from "child_process";

// ─── Environment detection ───────────────────────────────────────

export interface HeadlessEnvOpts {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  isTTY?: boolean;
}

/**
 * Decide whether the current process is running in a headless environment.
 *
 * OpenClaw can run in many places (desktop, Docker container, remote dev
 * server, Telegram/feishu bot host). In all non-desktop contexts we want
 * to render a prominent textual code box rather than try to spawn a
 * browser that won't exist.
 */
export function isHeadlessEnv(opts: HeadlessEnvOpts = {}): boolean {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const isTTY = opts.isTTY ?? Boolean(process.stdout && process.stdout.isTTY);

  const flag = String(env.AWARENESS_HEADLESS ?? "").toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes" || flag === "on") {
    return true;
  }
  if (flag === "0" || flag === "false" || flag === "no" || flag === "off") {
    return false;
  }

  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return true;
  if (String(env.CODESPACES ?? "").toLowerCase() === "true") return true;
  if (env.GITPOD_WORKSPACE_ID) return true;
  if (String(env.CLOUD_SHELL ?? "").toLowerCase() === "true") return true;

  if (platform === "linux") {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return true;
  }

  if (!isTTY) return true;

  return false;
}

// ─── Browser opener ──────────────────────────────────────────────

export function openBrowserSilently(url: string): boolean {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } else if (platform === "win32") {
      execSync(`start "" "${url}"`, { stdio: "ignore" });
    } else {
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Box renderer ────────────────────────────────────────────────

export interface DeviceCodeBoxArgs {
  userCode: string;
  verificationUri: string;
  expiresInSec?: number;
  headless?: boolean;
  product?: string;
}

function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + width - 3));
    i += width - 3;
  }
  return out.length > 0 ? out : [""];
}

export function renderDeviceCodeBox(args: DeviceCodeBoxArgs): string {
  const {
    userCode,
    verificationUri,
    expiresInSec,
    headless = false,
    product = "Awareness",
  } = args;

  const minutes = expiresInSec
    ? Math.max(1, Math.round(expiresInSec / 60))
    : null;
  const ttlLine = minutes
    ? `Code expires in ~${minutes} minute${minutes === 1 ? "" : "s"}.`
    : "";

  const W = 62;
  const pad = (s: string): string => {
    if (s.length >= W) return s.slice(0, W);
    return s + " ".repeat(W - s.length);
  };
  const top = "╔" + "═".repeat(W + 2) + "╗";
  const bot = "╚" + "═".repeat(W + 2) + "╝";
  const mid = (s = ""): string => "║ " + pad(s) + " ║";

  const lines: string[] = [];
  lines.push("");
  lines.push(top);
  lines.push(mid(`${product} Device Authorization`));
  lines.push(mid(""));
  if (headless) {
    lines.push(mid("Headless / remote host detected — no browser will be opened."));
    lines.push(mid(""));
    lines.push(mid("1. Open this URL on any device with a browser"));
    lines.push(mid("   (your phone or laptop works fine):"));
  } else {
    lines.push(mid("1. We tried to open your browser. If nothing happened,"));
    lines.push(mid("   visit this URL manually:"));
  }
  lines.push(mid(""));
  const urlLines = wrap(verificationUri, W);
  for (const line of urlLines) lines.push(mid("   " + line));
  lines.push(mid(""));
  lines.push(mid("2. Sign in (if needed) and enter this code:"));
  lines.push(mid(""));
  lines.push(mid(`       ┌─────────────────┐`));
  lines.push(mid(`       │   ${userCode.padEnd(13)} │`));
  lines.push(mid(`       └─────────────────┘`));
  lines.push(mid(""));
  if (ttlLine) lines.push(mid(ttlLine));
  lines.push(mid("Waiting for approval..."));
  lines.push(bot);
  lines.push("");

  return lines.join("\n");
}

// ─── Extended poll timeout ───────────────────────────────────────

export const DEFAULT_POLL_TIMEOUT_SEC = 840;
