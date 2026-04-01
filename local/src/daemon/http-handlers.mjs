import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jsonResponse } from './helpers.mjs';

export function handleHealthz(daemon, res, { version }) {
  const stats = daemon.indexer
    ? daemon.indexer.getStats()
    : { totalMemories: 0, totalKnowledge: 0, totalTasks: 0, totalSessions: 0 };

  return jsonResponse(res, {
    status: 'ok',
    mode: 'local',
    version,
    uptime: daemon._startedAt
      ? Math.floor((Date.now() - daemon._startedAt) / 1000)
      : 0,
    pid: process.pid,
    port: daemon.port,
    project_dir: daemon.projectDir,
    search_mode: daemon._embedder ? 'hybrid' : 'fts5-only',
    embedding: {
      available: !!daemon._embedder,
      model: daemon._embedder?.MODEL_MAP?.english || null,
      multilingual_model: daemon._embedder?.MODEL_MAP?.multilingual || null,
      auto_cjk_detection: true,
    },
    stats,
  });
}

export function handleWebUi(res, importMetaUrl) {
  try {
    const thisDir = path.dirname(fileURLToPath(importMetaUrl));
    const htmlPath = path.join(thisDir, 'web', 'index.html');
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(html);
      return;
    }
  } catch (err) {
    console.error('[awareness-local] failed to load web UI:', err.message);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Awareness Local</title></head>
<body style="font-family:system-ui;max-width:600px;margin:80px auto;color:#333">
  <h1>Awareness Local</h1>
  <p>Daemon is running. Web dashboard file not found.</p>
  <p><a href="/healthz">/healthz</a> &middot; <a href="/api/v1/stats">/api/v1/stats</a></p>
</body>
</html>`);
}
