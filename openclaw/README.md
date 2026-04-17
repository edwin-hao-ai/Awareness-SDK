# @awareness-sdk/openclaw-memory

[![npm](https://img.shields.io/npm/v/@awareness-sdk/openclaw-memory?color=7b68ee)](https://www.npmjs.com/package/@awareness-sdk/openclaw-memory) [![LongMemEval R@5](https://img.shields.io/badge/LongMemEval_R%405-95.6%25-brightgreen)](https://arxiv.org/abs/2410.10813) [![Discord](https://img.shields.io/discord/1354000000000000000?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.com/invite/nMDrT538Qa)

OpenClaw memory plugin backed by Awareness Memory Cloud.

Online docs: <https://awareness.market/docs?doc=openclaw>

## Benchmark: LongMemEval (ICLR 2025)

Awareness Memory achieves **95.6% Recall@5** on [LongMemEval](https://arxiv.org/abs/2410.10813) (ICLR 2025) — 500 human-curated questions, zero LLM calls, hybrid BM25+Vector retrieval. [Full results →](https://github.com/edwin-hao-ai/Awareness/tree/main/benchmarks/longmemeval)

```
╔══════════════════════════════════════════════════════════════╗
║   Awareness Memory — LongMemEval Benchmark Results           ║
║                                                              ║
║   Recall@1    77.6%       Recall@5    95.6%  ◀ PRIMARY       ║
║   Recall@3    91.8%       Recall@10   97.4%                  ║
║                                                              ║
║   Method:     Hybrid RRF (BM25 + Vector)                     ║
║   LLM Calls:  0       Hardware:  M1 8GB, 14 min             ║
╚══════════════════════════════════════════════════════════════╝
```

```
┌─────────────────────────────────────────────────────────────┐
│          Long-Term Memory Retrieval — R@5 Leaderboard       │
├─────────────────────────────────┬───────────┬───────────────┤
│  System                         │  R@5      │  Note         │
├─────────────────────────────────┼───────────┼───────────────┤
│  MemPalace (ChromaDB raw)       │  96.6%    │  R@5 only *   │
│  ★ Awareness Memory (Hybrid)    │  95.6%    │  Hybrid RRF   │
│  OMEGA                          │  95.4%    │  QA Accuracy  │
│  Supermemory                    │  81.6%    │  QA Accuracy  │
│  Zep / Graphiti                 │  71.2%    │  QA Accuracy  │
│  GPT-4o (full context)          │  60.6%    │  QA Accuracy  │
├─────────────────────────────────┴───────────┴───────────────┤
│  * MemPalace 96.6% is R@5 only, not QA Accuracy.           │
└─────────────────────────────────────────────────────────────┘
```

---

## Installation

**Plugin (full integration):**

```bash
openclaw plugins install @awareness-sdk/openclaw-memory
```

**Or Skill (via ClawHub):**

```bash
npx clawhub@latest install awareness-memory
```

For local development:

```bash
openclaw plugins install -l ./openclaw
```

## Configuration

Edit `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "slots": {
      "memory": "openclaw-memory"
    },
    "entries": {
      "openclaw-memory": {
        "enabled": true,
        "config": {
          "apiKey": "aw_your-api-key",
          "baseUrl": "https://awareness.market/api/v1",
          "memoryId": "your-memory-id",
          "agentRole": "builder_agent",
          "autoRecall": true,
          "autoCapture": true,
          "recallLimit": 8
        }
      }
    }
  }
}
```

For cloud or bot deployments, you can skip device-auth and config file edits by pre-setting environment variables on the server:

```bash
export AWARENESS_API_KEY="aw_your-api-key"
export AWARENESS_MEMORY_ID="your-memory-id"
export AWARENESS_BASE_URL="https://awareness.market/api/v1"
```

When these variables are present, the plugin will use them as the highest-priority cloud configuration.

## Available Tools

| Tool | Description |
|------|-------------|
| `__awareness_workflow__` | Workflow reference that stays visible in the tool list |
| `awareness_init` | Load cross-session project memory and context |
| `awareness_get_agent_prompt` | Fetch full activation prompt for a specific agent role (sub-agent spawning) |
| `awareness_recall` | Semantic + keyword hybrid recall from persistent memory |
| `awareness_lookup` | Structured data: tasks, knowledge, risks, timeline |
| `awareness_record` | Write events, batch save, ingest, update tasks |

## Auto Features

### Auto Recall

When `autoRecall` is enabled, the plugin loads context and relevant recall results before the agent starts.

### Auto Capture

When `autoCapture` is enabled, the plugin stores a concise run summary after the agent finishes.

## Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | required | Awareness API key |
| `memoryId` | string | required | Target memory UUID |
| `baseUrl` | string | `https://awareness.market/api/v1` | Awareness API base URL |
| `agentRole` | string | `builder_agent` | Agent role for scoped recall |
| `autoRecall` | boolean | `true` | Auto-load memory context before each run |
| `autoCapture` | boolean | `true` | Auto-store a conversation summary after each run |
| `recallLimit` | integer | `8` | Max results for auto-recall |

## Perception (Record-Time Signals)

When the skill's `awareness_record` tool writes to memory, the response may include a `perception` array -- automatic signals the system surfaces without you asking. These are computed from pure DB queries (no LLM calls), adding less than 50ms of latency.

**Signal types:**

| Type | Description |
|------|-------------|
| `contradiction` | New content conflicts with an existing knowledge card |
| `resonance` | Similar past experience found in memory |
| `pattern` | Recurring theme detected (e.g., same category appearing often) |
| `staleness` | A related knowledge card hasn't been updated in a long time |
| `related_decision` | A past decision is relevant to what you just recorded |

```typescript
// Inside the skill's record.js script:
const result = await awareness_record({
  content: "Decided to use RS256 for JWT signing",
  insights: {
    knowledge_cards: [{ title: "JWT signing", category: "decision", summary: "Use RS256" }]
  }
});
if (result.perception) {
  result.perception.forEach(s => console.log(`[${s.type}] ${s.message}`));
  // [pattern] This is the 4th 'decision' card -- recurring theme
  // [resonance] Similar past experience: "JWT auth migration"
}
```

## Verification

```bash
openclaw plugins list   # if installed as plugin
openclaw skills list    # if installed as skill
```

You should see `openclaw-memory` or `awareness-memory` loaded.

## What makes Awareness different

Most memory systems pick one extraction strategy. Awareness combines them:

- **Hybrid retrieval by default** — BM25 full-text + vector cosine + knowledge-graph 1-hop expansion, fused with Reciprocal Rank Fusion. 95.6% R@5 on LongMemEval, zero LLM calls on the retrieval side.
- **Salience-aware extraction** (v0.6.12+) — the agent's LLM self-scores every card on `novelty` / `durability` / `specificity`; cards below 0.4 on novelty or durability are dropped server-side. Framework metadata (`Sender (untrusted metadata)`, `turn_brief`, `[Operational context ...]`) is filtered before extraction runs, so raw log turns never leak into your knowledge base.
- **Project isolation** — `X-Awareness-Project-Dir` header scopes memory per project. Agents working on different projects from the same OpenClaw instance don't cross-contaminate.
- **Learning over time** — Ebbinghaus-style card decay, skill crystallization from repeated patterns (F-032 / F-034), workspace graph self-prune to keep `index.db` bounded.
- **Zero-LLM backend** — all extraction runs on the agent's LLM. The backend is a coordinator + storage layer; no inference costs pass through to you.
- **One memory, many clients** — same daemon reachable via Claude Code skills, OpenClaw plugin, npm / pip / ClawHub, and a plain MCP server. Install any one surface and the rest just work against the same memory.

See [`docs/analysis/MEMPALACE_COMPARISON_2026-04-17.md`](https://github.com/edwin-hao-ai/Awareness/blob/main/docs/analysis/MEMPALACE_COMPARISON_2026-04-17.md) for the honest side-by-side against MemPalace (96.6% R@5 via raw verbatim storage) — what we'd adopt from their approach and what we keep from ours.

## License

Apache-2.0
