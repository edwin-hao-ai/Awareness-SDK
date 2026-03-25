#!/usr/bin/env node
/**
 * Stdio-to-HTTP bridge for Awareness Local daemon MCP.
 * Reads JSON-RPC from stdin, forwards to http://localhost:37800/mcp,
 * writes response to stdout.
 *
 * Auto-starts the local daemon if not running.
 */
const http = require('http');
const { execSync, spawn } = require('child_process');

const MCP_URL = process.env.AWARENESS_MCP_URL || 'http://localhost:37800/mcp';
const parsed = new URL(MCP_URL);
const HEALTH_URL = `http://${parsed.hostname}:${parsed.port || 80}/healthz`;

let daemonReady = false;
let startAttempted = false;

/**
 * Check if daemon is running via /healthz.
 * @returns {Promise<boolean>}
 */
function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Try to start the local daemon via npx.
 * @returns {Promise<boolean>}
 */
async function ensureDaemon() {
  if (daemonReady) return true;

  // Quick health check
  if (await checkHealth()) {
    daemonReady = true;
    return true;
  }

  // Only attempt start once
  if (startAttempted) return false;
  startAttempted = true;

  try {
    // Fire-and-forget: start daemon in background
    const child = spawn('npx', ['-y', '@awareness-sdk/local', 'start'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    child.unref();

    // Poll for up to 8 seconds
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await checkHealth()) {
        daemonReady = true;
        return true;
      }
    }
  } catch {
    // npx not available or start failed
  }

  return false;
}

// Queue to serialize requests during daemon startup
let pendingQueue = [];
let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;

  while (pendingQueue.length > 0) {
    const line = pendingQueue.shift();
    await ensureDaemon();
    await forwardRequest(line);
  }

  processing = false;
}

function forwardRequest(postData) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 30000,
      },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          if (body.trim()) {
            process.stdout.write(body.trim() + '\n');
          }
          resolve();
        });
      },
    );

    req.on('error', (err) => {
      // Return JSON-RPC error
      let id = null;
      try { id = JSON.parse(postData).id; } catch {}
      const errResp = JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `Awareness daemon not running: ${err.message}` },
      });
      process.stdout.write(errResp + '\n');
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      let id = null;
      try { id = JSON.parse(postData).id; } catch {}
      const errResp = JSON.stringify({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: 'Request to daemon timed out' },
      });
      process.stdout.write(errResp + '\n');
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (!line) continue;

    try {
      JSON.parse(line); // validate
    } catch {
      continue;
    }

    pendingQueue.push(line);
    processQueue();
  }
});

process.stdin.on('end', () => process.exit(0));
