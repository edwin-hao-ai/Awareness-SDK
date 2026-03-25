#!/usr/bin/env node
/**
 * Stdio-to-HTTP bridge for Awareness Local daemon MCP.
 * Reads JSON-RPC from stdin, forwards to http://localhost:37800/mcp,
 * writes response to stdout.
 */
const http = require('http');

const MCP_URL = process.env.AWARENESS_MCP_URL || 'http://localhost:37800/mcp';
const parsed = new URL(MCP_URL);

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  // Try to parse complete JSON-RPC messages (newline-delimited)
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

    const postData = line;
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
    });

    req.write(postData);
    req.end();
  }
});

process.stdin.on('end', () => process.exit(0));
