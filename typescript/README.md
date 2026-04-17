# Awareness Memory SDK — TypeScript

[![npm](https://img.shields.io/npm/v/@awareness-sdk/memory-cloud?color=7b68ee)](https://www.npmjs.com/package/@awareness-sdk/memory-cloud) [![LongMemEval R@5](https://img.shields.io/badge/LongMemEval_R%405-95.6%25-brightgreen)](https://arxiv.org/abs/2410.10813) [![Discord](https://img.shields.io/discord/1354000000000000000?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.com/invite/nMDrT538Qa)

TypeScript SDK for adding persistent memory to AI agents and apps. **95.6% Recall@5 on [LongMemEval](https://arxiv.org/abs/2410.10813) (ICLR 2025)**.

Online docs: <https://awareness.market/docs?doc=typescript>

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

## Install

```bash
npm install @awareness-sdk/memory-cloud
```

---

## Zero-Code Interceptor

**The fastest way to add memory.** One line — no changes to your AI logic.

### Local mode (no API key needed)

```typescript
import OpenAI from "openai";
import { MemoryCloudClient, AwarenessInterceptor } from "@awareness-sdk/memory-cloud";

const client = new MemoryCloudClient({ mode: "local" }); // data stays on your machine
const interceptor = await AwarenessInterceptor.create({ client, memoryId: "my-project" });

const openai = new OpenAI();
interceptor.wrapOpenAI(openai); // one line — all conversations remembered

const response = await openai.chat.completions.create({
  model: "gpt-4",
  messages: [{ role: "user", content: "Refactor the auth module" }],
});
```

### Cloud mode (team collaboration, semantic search, sync)

```typescript
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { MemoryCloudClient, AwarenessInterceptor } from "@awareness-sdk/memory-cloud";

const client = new MemoryCloudClient({ apiKey: "aw_..." });
const interceptor = await AwarenessInterceptor.create({ client, memoryId: "memory_123" });

// Wrap OpenAI
const openai = new OpenAI();
interceptor.wrapOpenAI(openai);

// Or wrap Anthropic
const anthropic = new Anthropic();
interceptor.wrapAnthropic(anthropic);
```

---

## Direct API Quickstart

### Local mode

```typescript
import { MemoryCloudClient } from "@awareness-sdk/memory-cloud";

const client = new MemoryCloudClient({ mode: "local" }); // connects to localhost:8765

await client.record({ content: "Refactored auth middleware." });
const result = await client.retrieve({ query: "What did we refactor?" });
console.log(result.results);
```

### Cloud mode

```typescript
import { MemoryCloudClient } from "@awareness-sdk/memory-cloud";

const client = new MemoryCloudClient({
  baseUrl: process.env.AWARENESS_API_BASE_URL || "https://awareness.market/api/v1",
  apiKey: "YOUR_API_KEY",
});

await client.write({
  memoryId: "memory_123",
  content: "Customer asked for SOC2 report and DPA clause details.",
  kwargs: { source: "typescript-sdk", session_id: "demo-session" },
});

const result = await client.retrieve({
  memoryId: "memory_123",
  query: "What did the customer ask for?",
  customKwargs: { k: 3 },
});

console.log(result.results);
```

---

## MCP-style Helpers

### Local mode

```typescript
const client = new MemoryCloudClient({ mode: "local" });

await client.record({ content: "Completed JWT migration." });
const ctx = await client.recallForTask({ task: "summarize auth changes", limit: 8 });
console.log(ctx.results);
```

### Cloud mode

```typescript
const client = new MemoryCloudClient({
  baseUrl: "https://awareness.market/api/v1",
  apiKey: "YOUR_API_KEY",
});

// Record a single event
await client.record({
  memoryId: "memory_123",
  content: "Refactored auth middleware and added tests.",
});

// Record a batch of events
await client.record({
  memoryId: "memory_123",
  content: [
    { content: "Step 1: refactored middleware" },
    { content: "Step 2: added integration tests" },
  ],
});

// Recall task context
const ctx = await client.recallForTask({
  memoryId: "memory_123",
  task: "summarize latest auth changes",
  limit: 8,
});
console.log(ctx.results);
```

---

## Perception (Record-Time Signals)

When you call `record()`, the response may include a `perception` array -- automatic signals the system surfaces without you asking. These are computed from pure DB queries (no LLM calls), adding less than 50ms of latency.

**Signal types:**

| Type | Description |
|------|-------------|
| `contradiction` | New content conflicts with an existing knowledge card |
| `resonance` | Similar past experience found in memory |
| `pattern` | Recurring theme detected (e.g., same category appearing often) |
| `staleness` | A related knowledge card hasn't been updated in a long time |
| `related_decision` | A past decision is relevant to what you just recorded |

```typescript
const result = await client.record({
  memoryId: "memory_123",
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

---

## API Coverage

`MemoryCloudClient` includes:

- Memory: `createMemory`, `listMemories`, `getMemory`, `updateMemory`, `deleteMemory`
- Content: `write`, `listMemoryContent`, `deleteMemoryContent`
- Retrieval/Chat: `retrieve`, `chat`, `chatStream`, `memoryTimeline`
- MCP ingest: `ingestEvents`, `record` (use `record({ scope: "knowledge" })` instead of `ingestContent`)
- Export: `exportMemoryPackage`
- Async jobs & upload: `getAsyncJobStatus`, `uploadFile`, `getUploadJobStatus`
- Insights/API keys/wizard: `insights`, `createApiKey`, `listApiKeys`, `revokeApiKey`, `memoryWizard`

---

## Read Exported Packages

```typescript
import { readExportPackage } from "@awareness-sdk/memory-cloud";

const parsed = await readExportPackage(zipBytes);
console.log(parsed.manifest);
console.log(parsed.chunks.length);
console.log(Boolean(parsed.safetensors));
console.log(parsed.kvSummary);
```

Readers: `readExportPackage(input)`, `parseJsonlText(text)`

---

## Examples

- Basic flow: `examples/basic-flow.ts`
- Export + read package: `examples/export-and-read.ts`

---

## What makes Awareness different

Most memory systems pick one extraction strategy. Awareness combines them:

- **Hybrid retrieval by default** — BM25 full-text + vector cosine + knowledge-graph 1-hop expansion, fused with Reciprocal Rank Fusion. 95.6% R@5 on LongMemEval, zero LLM calls on the retrieval side.
- **Salience-aware extraction** — the client's own LLM self-scores every card on `novelty` / `durability` / `specificity`; cards below 0.4 on novelty or durability are dropped server-side. Framework metadata (`Sender (untrusted metadata)`, `turn_brief`) is filtered before extraction runs.
- **Project isolation** — `X-Awareness-Project-Dir` header scopes memory per project.
- **Zero-LLM backend** — all extraction runs on your LLM (Claude, GPT-4, Gemini, local Llama). The backend is a coordinator + storage layer; no inference costs pass through to you.
- **One memory, many clients** — same data reachable via Claude Code, OpenClaw, npm / pip / ClawHub, MCP server.

See [`docs/analysis/MEMPALACE_COMPARISON_2026-04-17.md`](https://github.com/edwin-hao-ai/Awareness/blob/main/docs/analysis/MEMPALACE_COMPARISON_2026-04-17.md) for the honest side-by-side against MemPalace.
