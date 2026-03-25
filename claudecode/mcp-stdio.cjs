#!/usr/bin/env node
/**
 * mcp-stdio.cjs — Zero-dependency stdio MCP server for Awareness Local.
 *
 * Implements the MCP JSON-RPC protocol over stdin/stdout directly,
 * no @modelcontextprotocol/sdk needed. Proxies all tool calls to
 * the local daemon at http://localhost:37800/mcp.
 *
 * Auto-starts daemon if not running.
 */

const http = require('http');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.AWARENESS_LOCAL_PORT || '37800', 10);

// ── Logging (stderr only) ─────────────────────────────────────────────

function log(...args) {
  process.stderr.write(`[awareness-mcp] ${args.join(' ')}\n`);
}

// ── HTTP helpers ──────────────────────────────────────────────────────

function httpPost(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error('Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path, method: 'GET',
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ── Daemon auto-start ────────────────────────────────────────────────

let daemonReady = false;

async function checkHealth() {
  try {
    const r = await httpGet(PORT, '/healthz');
    return r.status === 200;
  } catch { return false; }
}

async function ensureDaemon() {
  if (daemonReady) return true;
  if (await checkHealth()) { daemonReady = true; return true; }

  log('Daemon not running, starting...');
  const child = spawn('npx', ['-y', '@awareness-sdk/local', 'start'], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await checkHealth()) { daemonReady = true; log('Daemon ready'); return true; }
  }
  log('Failed to start daemon within 15s');
  return false;
}

// ── Tool definitions ─────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'awareness_init',
    description: 'Start a new session and load context (knowledge cards, tasks, rules). Call this at the beginning of every conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'Memory identifier (ignored in local mode)' },
        source: { type: 'string', description: 'Client source identifier' },
        days: { type: 'number', description: 'Days of history to load', default: 7 },
        max_cards: { type: 'number', default: 5 },
        max_tasks: { type: 'number', default: 5 },
      },
    },
  },
  {
    name: 'awareness_recall',
    description: 'Search persistent memory for past decisions, solutions, and knowledge. Use progressive disclosure: detail=summary first, then detail=full with ids.',
    inputSchema: {
      type: 'object',
      properties: {
        semantic_query: { type: 'string', description: 'Natural language search query' },
        keyword_query: { type: 'string', description: 'Exact keyword match' },
        scope: { type: 'string', enum: ['all', 'timeline', 'knowledge', 'insights'], default: 'all' },
        recall_mode: { type: 'string', enum: ['precise', 'session', 'structured', 'hybrid', 'auto'], default: 'hybrid' },
        limit: { type: 'number', default: 10, maximum: 30 },
        detail: { type: 'string', enum: ['summary', 'full'], default: 'summary' },
        ids: { type: 'array', items: { type: 'string' }, description: 'Item IDs to expand (with detail=full)' },
        agent_role: { type: 'string' },
      },
    },
  },
  {
    name: 'awareness_record',
    description: 'Record memories, update tasks, or submit insights. Use action=remember for single records, remember_batch for bulk.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['remember', 'remember_batch', 'update_task', 'submit_insights'] },
        content: { type: 'string', description: 'Memory content (markdown)' },
        title: { type: 'string' },
        items: { type: 'array', description: 'Batch items for remember_batch' },
        insights: { type: 'object', description: 'Pre-extracted knowledge cards, tasks, risks' },
        session_id: { type: 'string' },
        agent_role: { type: 'string' },
        event_type: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        task_id: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'awareness_lookup',
    description: 'Fast DB lookup — use instead of awareness_recall when you know what type of data you want.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['context', 'tasks', 'knowledge', 'risks', 'session_history', 'timeline'] },
        limit: { type: 'number', default: 10 },
        status: { type: 'string' },
        category: { type: 'string' },
        priority: { type: 'string' },
        session_id: { type: 'string' },
        agent_role: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['type'],
    },
  },
  {
    name: 'awareness_get_agent_prompt',
    description: 'Get the activation prompt for a specific agent role.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Agent role to get prompt for' },
      },
    },
  },
];

// ── Proxy tool call to daemon ────────────────────────────────────────

async function proxyToolCall(toolName, args) {
  await ensureDaemon();
  const rpc = {
    jsonrpc: '2.0', id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: args || {} },
  };
  const resp = await httpPost(PORT, '/mcp', rpc);
  if (resp.error) throw new Error(resp.error.message || JSON.stringify(resp.error));
  return resp.result;
}

// ── JSON-RPC stdio handler ───────────────────────────────────────────

let rpcId = 0;

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(msg + '\n');
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(msg + '\n');
}

async function handleRequest(req) {
  const { id, method, params } = req;

  switch (method) {
    case 'initialize':
      return sendResponse(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'awareness-memory', version: '0.2.0' },
        capabilities: { tools: {} },
      });

    case 'notifications/initialized':
      // No response needed for notifications
      return;

    case 'tools/list':
      return sendResponse(id, { tools: TOOLS });

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};
      try {
        const result = await proxyToolCall(toolName, args);
        return sendResponse(id, result);
      } catch (err) {
        return sendResponse(id, {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
          isError: true,
        });
      }
    }

    default:
      if (id) sendError(id, -32601, `Method not found: ${method}`);
  }
}

// ── Stdin line parser ────────────────────────────────────────────────

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
      const req = JSON.parse(line);
      handleRequest(req).catch(err => {
        log('Handler error:', err.message);
        if (req.id) sendError(req.id, -32603, err.message);
      });
    } catch (e) {
      log('Parse error:', e.message);
    }
  }
});

process.stdin.on('end', () => process.exit(0));

log('stdio MCP server started (daemon port=' + PORT + ')');
