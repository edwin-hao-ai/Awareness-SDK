/**
 * Device Code Auth + Memory management for Awareness CLI.
 *
 * Zero external dependencies — uses only node:https, node:http, node:fs, node:os, node:path,
 * node:child_process builtins.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const DEFAULT_API_BASE = "https://awareness.market/api/v1";
const CREDENTIALS_DIR = path.join(os.homedir(), ".awareness");
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "credentials.json");

// ─── HTTP helper ─────────────────────────────────────────────────

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const body = options.body ? JSON.stringify(options.body) : undefined;

    const req = mod.request(
      parsedUrl,
      {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
        timeout: options.timeout || 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, data: {} });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    if (body) req.write(body);
    req.end();
  });
}

// ─── Browser opener ──────────────────────────────────────────────

export function openBrowser(url) {
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

// ─── Credentials storage ─────────────────────────────────────────

export function saveCredentials(apiKey, apiBase = DEFAULT_API_BASE) {
  try {
    if (!fs.existsSync(CREDENTIALS_DIR)) {
      fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
    }
    const data = JSON.stringify({ api_key: apiKey, api_base: apiBase }, null, 2) + "\n";
    fs.writeFileSync(CREDENTIALS_FILE, data, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function loadCredentials() {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    const raw = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
    const creds = JSON.parse(raw);
    if (creds.api_key) return creds;
    return null;
  } catch {
    return null;
  }
}

export function clearCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) fs.unlinkSync(CREDENTIALS_FILE);
    return true;
  } catch {
    return false;
  }
}

// ─── Device Code Auth ────────────────────────────────────────────

export async function initDeviceAuth(apiBase = DEFAULT_API_BASE) {
  const { status, data } = await request(`${apiBase}/auth/device/init`, {
    method: "POST",
    body: {},
  });
  if (status !== 200 || !data.device_code) {
    throw new Error(data.detail || "Failed to initialize device auth");
  }
  return data;
}

export async function pollDeviceAuth(apiBase, deviceCode, interval = 5, timeout = 300) {
  const deadline = Date.now() + timeout * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));

    try {
      const { data } = await request(`${apiBase}/auth/device/poll`, {
        method: "POST",
        body: { device_code: deviceCode },
      });

      if (data.status === "approved" && data.api_key) {
        return data;
      }
      if (data.status === "expired") {
        throw new Error("Device code expired. Please try again.");
      }
      // status === "pending" — continue polling
    } catch (e) {
      if (e.message.includes("expired")) throw e;
      // Network error — continue polling
    }
  }

  throw new Error("Authorization timed out. Please try again.");
}

// ─── Memory listing and creation ─────────────────────────────────

export async function listMemories(apiBase, apiKey) {
  const { status, data } = await request(`${apiBase}/memories`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (status !== 200) {
    throw new Error(data.detail || "Failed to list memories");
  }
  // API returns array or { items: [] } depending on endpoint
  return Array.isArray(data) ? data : data.items || data.memories || [];
}

export async function createMemoryViaWizard(apiBase, apiKey, description, locale = "en") {
  // Step 1: Call wizard to get create_payload
  const wizardBody = {
    owner_id: "", // will be set from auth
    locale,
    messages: [{ role: "user", content: description }],
    draft: {},
  };

  const { status: wizStatus, data: wizData } = await request(
    `${apiBase}/wizard/memory_designer`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: wizardBody,
      timeout: 30000,
    }
  );

  if (wizStatus !== 200 || !wizData.plan?.create_payload) {
    throw new Error("Memory wizard failed to generate a plan");
  }

  const createPayload = wizData.plan.create_payload;

  // Step 2: Create the memory
  const { status: createStatus, data: createData } = await request(
    `${apiBase}/memories`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: createPayload,
    }
  );

  if (createStatus !== 200 && createStatus !== 201) {
    throw new Error(createData.detail || "Failed to create memory");
  }

  return {
    memory: createData,
    plan: wizData.plan,
  };
}

// ─── Token savings ───────────────────────────────────────────────

export async function getTokenSavings(apiBase, apiKey) {
  try {
    const { status, data } = await request(
      `${apiBase}/users/me/token-savings?days=30`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );
    if (status !== 200) return null;
    return data;
  } catch {
    return null;
  }
}

export function formatTokenSavings(savings) {
  if (!savings || !savings.total_tokens_saved) return null;

  const saved = savings.total_tokens_saved;
  const rate = savings.compression_rate || 0;
  const pricingModels = savings.pricing_models || {};

  const formatCount = (n) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const lines = [
    `Token savings (30d): ${formatCount(saved)} tokens saved (${Math.round(rate * 100)}% compression)`,
  ];

  const costEntries = Object.entries(pricingModels);
  if (costEntries.length > 0) {
    const costs = costEntries
      .map(([tier, pricePerMillion]) => {
        const cost = ((saved / 1_000_000) * pricePerMillion).toFixed(2);
        return `$${cost} (${tier})`;
      })
      .join(" / ");
    lines.push(`   Estimated cost saved: ${costs}`);
  }

  return lines.join("\n");
}

// ─── Full auth flow ──────────────────────────────────────────────

/**
 * Run the full device code auth flow interactively.
 * Returns { apiKey, apiBase } on success, or null if skipped/failed.
 */
export async function runAuthFlow(apiBase = DEFAULT_API_BASE, options = {}) {
  const { prompt } = options;

  // Check existing credentials
  const existing = loadCredentials();
  if (existing) {
    console.log(`Already logged in (key: ${existing.api_key.slice(0, 10)}...).`);
    return existing;
  }

  console.log("\nAuthenticating with Awareness...\n");

  let authData;
  try {
    authData = await initDeviceAuth(apiBase);
  } catch (e) {
    console.error(`Auth init failed: ${e.message}`);
    return null;
  }

  console.log(`Your code: ${authData.user_code}\n`);

  const verificationUrl = `${authData.verification_uri}?code=${encodeURIComponent(authData.user_code)}`;
  const opened = openBrowser(verificationUrl);

  if (opened) {
    console.log("Browser opened. Please sign in and authorize the CLI.");
  } else {
    console.log(`Open this URL to authorize:\n  ${verificationUrl}`);
  }

  console.log("\nWaiting for authorization...");

  try {
    const result = await pollDeviceAuth(
      apiBase,
      authData.device_code,
      authData.interval || 5,
      authData.expires_in || 300
    );

    saveCredentials(result.api_key, apiBase);
    console.log("Authorized successfully!\n");

    return { api_key: result.api_key, api_base: apiBase };
  } catch (e) {
    console.error(`\nAuthorization failed: ${e.message}`);
    return null;
  }
}

/**
 * Interactive memory selection/creation flow.
 * Returns { memoryId, memoryName } or null.
 */
export async function runMemoryFlow(apiBase, apiKey, options = {}) {
  const { prompt } = options;

  let memories;
  try {
    memories = await listMemories(apiBase, apiKey);
  } catch (e) {
    console.error(`Failed to list memories: ${e.message}`);
    return null;
  }

  if (memories.length === 0) {
    // No memories — create one
    console.log("You don't have any memories yet. Let's create one!\n");
    return await createNewMemory(apiBase, apiKey, prompt);
  }

  // Has memories — show list with "Create new" option
  console.log("\nYour memories:");
  memories.forEach((mem, i) => {
    const name = mem.name || "Unnamed";
    console.log(`  ${i + 1}. ${name}`);
  });
  console.log(`  ${memories.length + 1}. Create new memory`);
  console.log("");

  if (!prompt) {
    // Non-interactive: use the most recently updated memory
    const mem = memories[0];
    return { memoryId: mem.id, memoryName: mem.name };
  }

  const answer = String(
    await prompt(`Select memory (1-${memories.length + 1}) [1]: `)
  ).trim();

  const num = answer ? Number(answer) : 1;

  if (num === memories.length + 1) {
    // Create new
    return await createNewMemory(apiBase, apiKey, prompt);
  }

  if (Number.isInteger(num) && num >= 1 && num <= memories.length) {
    const mem = memories[num - 1];
    return { memoryId: mem.id, memoryName: mem.name };
  }

  // Default to first
  const mem = memories[0];
  return { memoryId: mem.id, memoryName: mem.name };
}

async function createNewMemory(apiBase, apiKey, prompt) {
  let description = "";
  if (prompt) {
    description = String(
      await prompt("Describe what this memory is for: ")
    ).trim();
  }

  if (!description) {
    description = "General-purpose memory for development workflow";
  }

  console.log("\nCreating memory...");

  try {
    const { memory, plan } = await createMemoryViaWizard(
      apiBase,
      apiKey,
      description
    );

    const name = memory.name || plan.name || "New Memory";
    const id = memory.id;

    console.log(`Created memory: ${name} (${id})\n`);
    return { memoryId: id, memoryName: name };
  } catch (e) {
    console.error(`Failed to create memory: ${e.message}`);
    return null;
  }
}
