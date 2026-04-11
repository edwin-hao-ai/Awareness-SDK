/**
 * headless-auth.mjs — Shared UX helper for RFC 8628 device code flow in
 * headless / remote / no-browser environments.
 *
 * Zero external dependencies. Node builtins only.
 *
 * IMPORTANT: This file is copy-pasted into 4 independently-published packages:
 *   - sdks/setup-cli/src/headless-auth.mjs             (this file)
 *   - sdks/awareness-memory/scripts/headless-auth.js
 *   - sdks/claudecode/scripts/headless-auth.js
 *   - sdks/openclaw/src/headless-auth.ts
 *
 * If you change one, sync the other three. See docs/features/f-035/.
 */

import { execSync } from "node:child_process";

// ─── Environment detection ───────────────────────────────────────

/**
 * Decide whether the current process is running in a headless environment
 * where trying to open a browser via `open`/`xdg-open`/`start` would fail
 * or be unhelpful.
 *
 * Returns true when ANY of the following are true:
 *   1. Explicit opt-in: env.AWARENESS_HEADLESS is set to "1", "true", "yes"
 *   2. Explicit opt-out: env.AWARENESS_HEADLESS is NOT "0"/"false"/"no" AND
 *      any of:
 *      - SSH_CONNECTION, SSH_CLIENT, SSH_TTY is set (SSH session)
 *      - CODESPACES === "true" (GitHub Codespaces)
 *      - GITPOD_WORKSPACE_ID is set (Gitpod)
 *      - CLOUD_SHELL === "true" (Google Cloud Shell)
 *      - STY is set (GNU screen — often used in remote contexts)
 *      - On Linux: DISPLAY is empty AND WAYLAND_DISPLAY is empty
 *      - stdout is NOT a TTY (piped/redirected — can't reasonably open browser)
 *
 * @param {{env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, isTTY?: boolean}} [opts]
 * @returns {boolean}
 */
export function isHeadlessEnv(opts = {}) {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const isTTY = opts.isTTY ?? Boolean(process.stdout && process.stdout.isTTY);

  // Explicit opt-in wins.
  const flag = String(env.AWARENESS_HEADLESS ?? "").toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes" || flag === "on") {
    return true;
  }
  // Explicit opt-out wins too.
  if (flag === "0" || flag === "false" || flag === "no" || flag === "off") {
    return false;
  }

  // Auto-detection. We're conservative: we need a clear signal before
  // assuming no browser. A false positive (treating a normal desktop as
  // headless) only costs users "copy URL manually" instead of automatic
  // browser open, so the downside is small.

  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return true;
  if (String(env.CODESPACES ?? "").toLowerCase() === "true") return true;
  if (env.GITPOD_WORKSPACE_ID) return true;
  if (String(env.CLOUD_SHELL ?? "").toLowerCase() === "true") return true;

  // On Linux, lack of DISPLAY/WAYLAND means no GUI session.
  if (platform === "linux") {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return true;
  }

  // Non-interactive invocation — CI, script pipe, etc.
  if (!isTTY) return true;

  return false;
}

// ─── Browser opener ──────────────────────────────────────────────

/**
 * Try to open a URL in the system default browser. Always returns a
 * boolean — never throws. On headless systems this will silently return
 * false.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function openBrowserSilently(url) {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } else if (platform === "win32") {
      execSync(`start "" "${url}"`, { stdio: "ignore" });
    } else {
      // Linux / other: xdg-open. May not be installed on headless Linux.
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Box renderer ────────────────────────────────────────────────

/**
 * Render a prominent multi-line ASCII box showing the verification URL
 * and user code. Used whenever we can't rely on the user seeing an
 * opened browser window.
 *
 * @param {{
 *   userCode: string,
 *   verificationUri: string,
 *   expiresInSec?: number,
 *   headless?: boolean,
 *   product?: string,
 * }} args
 * @returns {string}
 */
export function renderDeviceCodeBox(args) {
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

  const W = 62; // content width inside box
  const lines = [];
  const pad = (s) => {
    const visible = s;
    if (visible.length >= W) return visible.slice(0, W);
    return visible + " ".repeat(W - visible.length);
  };

  const top = "╔" + "═".repeat(W + 2) + "╗";
  const bot = "╚" + "═".repeat(W + 2) + "╝";
  const mid = (s = "") => "║ " + pad(s) + " ║";

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
  // URL may be long — wrap if needed, but keep first chunk highlighted.
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

/** Simple word-agnostic hard wrap for URLs / long strings. */
function wrap(s, width) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    out.push(s.slice(i, i + width - 3));
    i += width - 3;
  }
  return out.length > 0 ? out : [""];
}

// ─── Extended poll timeout ───────────────────────────────────────

/**
 * Default poll timeout in seconds. Aligned slightly below backend Redis
 * TTL (900s) so we can surface a clean "timed out" error before the
 * server reports "expired".
 */
export const DEFAULT_POLL_TIMEOUT_SEC = 840;
