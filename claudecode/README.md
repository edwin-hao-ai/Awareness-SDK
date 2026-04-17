# Awareness Memory — Claude Code Plugin

[![LongMemEval R@5](https://img.shields.io/badge/LongMemEval_R%405-95.6%25-brightgreen)](https://arxiv.org/abs/2410.10813) [![Discord](https://img.shields.io/discord/1354000000000000000?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.com/invite/nMDrT538Qa)

Persistent cross-session memory for Claude Code via [Awareness](https://awareness.market). Local-first — works offline, no account needed.

Gives Claude Code a long-term memory that survives across sessions — no more forgetting what was built, repeating architectural decisions, or losing track of open TODOs.

Online docs: <https://awareness.market/docs?doc=ide-plugins>

## Benchmark: LongMemEval (ICLR 2025)

Awareness Memory is evaluated on **[LongMemEval](https://arxiv.org/abs/2410.10813)** — the industry standard benchmark for long-term conversational memory, published at ICLR 2025. 500 human-curated questions across 5 core capabilities.

```
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   Awareness Memory — LongMemEval Benchmark Results           ║
║   ─────────────────────────────────────────────────           ║
║                                                              ║
║   Benchmark:  LongMemEval (ICLR 2025)                       ║
║   Dataset:    500 human-curated questions                    ║
║   Variant:    LongMemEval_S (~115k tokens per question)      ║
║                                                              ║
║   ┌─────────────────────────────────────────────────┐        ║
║   │                                                 │        ║
║   │   Recall@1    77.6%    (388 / 500)              │        ║
║   │   Recall@3    91.8%    (459 / 500)              │        ║
║   │   Recall@5    95.6%    (478 / 500)  ◀ PRIMARY   │        ║
║   │   Recall@10   97.4%    (487 / 500)              │        ║
║   │                                                 │        ║
║   └─────────────────────────────────────────────────┘        ║
║                                                              ║
║   Method:     Hybrid RRF (BM25 + Semantic Vector Search)     ║
║   Embedding:  all-MiniLM-L6-v2 (384d)                       ║
║   LLM Calls:  0  (pure retrieval, no generation cost)        ║
║   Hardware:   Apple M1, 8GB RAM — 14 min total               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### Leaderboard

```
┌─────────────────────────────────────────────────────────────┐
│          Long-Term Memory Retrieval — R@5 Leaderboard       │
│          LongMemEval (ICLR 2025, 500 questions)             │
├─────────────────────────────────┬───────────┬───────────────┤
│  System                         │  R@5      │  Note         │
├─────────────────────────────────┼───────────┼───────────────┤
│  MemPalace (ChromaDB raw)       │  96.6%    │  R@5 only *   │
│  ★ Awareness Memory (Hybrid)    │  95.6%    │  Hybrid RRF   │
│  OMEGA                          │  95.4%    │  QA Accuracy  │
│  Mastra (GPT-5-mini)            │  94.9%    │  QA Accuracy  │
│  Mastra (GPT-4o)                │  84.2%    │  QA Accuracy  │
│  Supermemory                    │  81.6%    │  QA Accuracy  │
│  Zep / Graphiti                 │  71.2%    │  QA Accuracy  │
│  GPT-4o (full context)          │  60.6%    │  QA Accuracy  │
├─────────────────────────────────┴───────────┴───────────────┤
│  * MemPalace 96.6% is Recall@5 only, not QA Accuracy.      │
│    Palace hierarchy was NOT used in the evaluation.         │
└─────────────────────────────────────────────────────────────┘
```

### Accuracy by Question Type

```
┌─────────────────────────────────────────────────────────────┐
│     Awareness Memory — R@5 by Question Type                 │
│                                                             │
│  knowledge-update        ████████████████████████████ 100%  │
│  multi-session           ███████████████████████████▋  98.5%│
│  single-session-asst     ███████████████████████████▌  98.2%│
│  temporal-reasoning      █████████████████████████▊    94.7%│
│  single-session-user     ████████████████████████▎     88.6%│
│  single-session-pref     ███████████████████████▏      86.7%│
│                                                             │
│  Overall                 █████████████████████████▉    95.6%│
│                                                             │
│  ┌───────────────────────────────────────────────┐          │
│  │  Ablation Study                               │          │
│  │  ─────────────────────────────────────────    │          │
│  │  Vector-only:   92.6%  ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░     │          │
│  │  BM25-only:     91.4%  ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░     │          │
│  │  Hybrid RRF:    95.6%  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░  ★  │          │
│  │                        Hybrid = +3% over any  │          │
│  │                        single method alone    │          │
│  └───────────────────────────────────────────────┘          │
│                                                             │
│  arxiv.org/abs/2410.10813          awareness.market         │
└─────────────────────────────────────────────────────────────┘
```

Zero LLM calls. Runs on Apple M1 8GB in 14 minutes. [Reproducible benchmark scripts →](https://github.com/edwin-hao-ai/Awareness/tree/main/benchmarks/longmemeval)

---

## Quick Start

### 1. Install the plugin

```bash
# From GitHub marketplace (recommended)
/plugin marketplace add edwin-hao-ai/Awareness-SDK
/plugin install awareness-memory@awareness

# Or from local directory (dev)
claude plugin install -l ./claudecode
```

### 2. One-command setup (recommended)

After installing, just run:

```
/awareness-memory:setup
```

This will:
- Open your browser to sign in (or create an account)
- Let you select (or create) a memory
- Automatically write your credentials to settings.json

After setup completes, restart Claude Code and you're ready to go.

### 3. Manual configuration (alternative)

If you prefer to configure manually, edit `~/.claude/plugins/awareness-memory/settings.json`:

```json
{
  "env": {
    "AWARENESS_MCP_URL": "https://awareness.market/mcp",
    "AWARENESS_MEMORY_ID": "your-memory-id",
    "AWARENESS_API_KEY": "aw_your-api-key",
    "AWARENESS_AGENT_ROLE": "builder_agent"
  }
}
```

Get your `AWARENESS_API_KEY` and `AWARENESS_MEMORY_ID` from the [Awareness Dashboard](https://awareness.market/dashboard) → Connect tab.

For local self-hosted deployments, set `AWARENESS_MCP_URL` to `http://localhost:8001/mcp`.

### 4. Verify

```bash
# Check MCP server is connected
claude /mcp
# Should show: awareness-memory ✓

# Load memory context
/awareness-memory:session-start
```

---

## Available Skills

| Skill | Command | When to Use |
|-------|---------|-------------|
| `setup` | `/awareness-memory:setup` | First time — authenticate via browser and configure credentials |
| `session-start` | `/awareness-memory:session-start` | Start of every session — loads recent progress, open tasks, relevant context |
| `recall` | `/awareness-memory:recall <query>` | Before implementing anything — check if it already exists |
| `save` | `/awareness-memory:save` | After completing a step or before ending a session |
| `done` | `/awareness-memory:done` | Close the session with a final summary and handoff |

---

## Recommended Workflow

```
Session starts
  └─ /awareness-memory:session-start      ← load context

Before new feature
  └─ /awareness-memory:recall "feature name"  ← check existing work

During development (after each meaningful change)
  └─ Claude auto-saves via awareness_record

Before ending session
  └─ /awareness-memory:save               ← persist progress

Next session
  └─ /awareness-memory:session-start      ← full context restored
```

---

## MCP Tools Available

Once connected, Claude Code has access to these Awareness MCP tools:

| Tool | Description |
|------|-------------|
| `__awareness_workflow__` | Workflow checklist — call when unsure what to do next |
| `awareness_init` | Load cross-session project memory and context |
| `awareness_get_agent_prompt` | Fetch full activation prompt for a specific agent role (sub-agent spawning) |
| `awareness_recall` | Semantic + keyword hybrid recall from persistent memory |
| `awareness_lookup` | Structured data: tasks, knowledge, risks, timeline |
| `awareness_record` | Write events, batch save, ingest, update tasks |

---

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `AWARENESS_MCP_URL` | Awareness MCP server URL | `https://awareness.market/mcp` |
| `AWARENESS_MEMORY_ID` | Target memory instance UUID | *(required)* |
| `AWARENESS_API_KEY` | Awareness API key (`aw_` prefix) | *(required)* |
| `AWARENESS_AGENT_ROLE` | Agent role for scoped recall | `builder_agent` |

---

## Troubleshooting

**"Not configured yet" message on session start**
- Run `/awareness-memory:setup` to authenticate and configure in one step
- Or manually edit `settings.json` with your API key and memory ID

**MCP server not appearing in `/mcp`**
- Make sure you restarted Claude Code after running `/awareness-memory:setup`
- Check that `AWARENESS_MCP_URL` is reachable
- Verify `AWARENESS_API_KEY` is valid (starts with `aw_`)
- Run `claude plugin list` to confirm the plugin is installed

**Setup browser not opening**
- The `/awareness-memory:setup` skill will show you a URL to open manually
- Make sure you complete authorization within 10 minutes

**Skills returning empty results**
- Ensure `AWARENESS_MEMORY_ID` points to a memory with data
- Visit the Awareness Dashboard → Data tab to verify stored memories

**Local deployment**
- Set `AWARENESS_MCP_URL` to `http://localhost:8001/mcp`
- Ensure you have a valid API key from [https://awareness.market/dashboard](https://awareness.market/dashboard)

---

## What makes Awareness different

Most memory systems pick one extraction strategy. Awareness combines them:

- **Hybrid retrieval by default** — BM25 full-text + vector cosine + knowledge-graph 1-hop expansion, fused with Reciprocal Rank Fusion. 95.6% R@5 on LongMemEval, zero LLM calls on the retrieval side.
- **Salience-aware extraction** — Claude self-scores every card on `novelty` / `durability` / `specificity`; cards below 0.4 on novelty or durability are dropped server-side. Framework metadata (`Sender (untrusted metadata)`, `turn_brief`, `[Operational context ...]`) is filtered before extraction runs, so raw tool-use turns never leak into your knowledge base.
- **Project isolation** — `X-Awareness-Project-Dir` header scopes memory per project. Your work memory doesn't leak into your personal memory, even on the same machine.
- **Learning over time** — Ebbinghaus-style card decay, skill crystallization from repeated patterns, workspace graph self-prune to keep `index.db` bounded.
- **Zero-LLM backend** — all extraction runs on Claude itself. The backend is a coordinator + storage layer; no inference costs pass through to you.
- **One memory, many clients** — same daemon reachable via Claude Code skills, OpenClaw plugin, npm / pip / ClawHub, and a plain MCP server. Install any one surface and the rest just work against the same memory.

See [`docs/analysis/MEMPALACE_COMPARISON_2026-04-17.md`](https://github.com/edwin-hao-ai/Awareness/blob/main/docs/analysis/MEMPALACE_COMPARISON_2026-04-17.md) for the honest side-by-side against MemPalace (96.6% R@5 via raw verbatim storage) — what we'd adopt from their approach and what we keep from ours.

---

## License

Apache-2.0
