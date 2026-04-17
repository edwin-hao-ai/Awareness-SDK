# Awareness Memory SDK — Python

[![PyPI](https://img.shields.io/pypi/v/awareness-memory-cloud?color=00d4ff)](https://pypi.org/project/awareness-memory-cloud/) [![LongMemEval R@5](https://img.shields.io/badge/LongMemEval_R%405-95.6%25-brightgreen)](https://arxiv.org/abs/2410.10813) [![Discord](https://img.shields.io/discord/1354000000000000000?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.com/invite/nMDrT538Qa)

Python SDK for adding persistent memory to AI agents and apps. **95.6% Recall@5 on [LongMemEval](https://arxiv.org/abs/2410.10813) (ICLR 2025)**.

Online docs: <https://awareness.market/docs?doc=python>

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
pip install awareness-memory-cloud
```

Framework extras:

```bash
pip install -e ".[langchain]"   # LangChain adapter
pip install -e ".[crewai]"      # CrewAI adapter
pip install -e ".[autogen]"     # AutoGen adapter
pip install -e ".[frameworks]"  # All frameworks
```

---

## Zero-Code Interceptor

**The fastest way to add memory.** One line — no changes to your AI logic.

### Local mode (no API key needed)

```python
from openai import OpenAI
from memory_cloud import MemoryCloudClient, AwarenessInterceptor

client = MemoryCloudClient(mode="local")  # data stays on your machine
interceptor = AwarenessInterceptor(client=client, memory_id="my-project")

openai_client = OpenAI()
interceptor.wrap_openai(openai_client)  # one line — all conversations remembered

response = openai_client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Refactor the auth module"}],
)
```

### Cloud mode (team collaboration, semantic search, sync)

```python
from openai import OpenAI
from anthropic import Anthropic
from memory_cloud import MemoryCloudClient, AwarenessInterceptor

client = MemoryCloudClient(api_key="aw_...")
interceptor = AwarenessInterceptor(client=client, memory_id="memory_123")

# Wrap OpenAI
openai_client = OpenAI()
interceptor.wrap_openai(openai_client)

# Or wrap Anthropic
anthropic_client = Anthropic()
interceptor.wrap_anthropic(anthropic_client)
```

---

## Direct API Quickstart

### Local mode

```python
from memory_cloud import MemoryCloudClient

client = MemoryCloudClient(mode="local")  # connects to local daemon at localhost:8765

client.record(content="Refactored auth middleware.")
result = client.retrieve(query="What did we refactor?")
print(result["results"])
```

### Cloud mode

```python
import os
from memory_cloud import MemoryCloudClient

client = MemoryCloudClient(
    base_url=os.getenv("AWARENESS_API_BASE_URL", "https://awareness.market/api/v1"),
    api_key="YOUR_API_KEY",
)

client.write(
    memory_id="memory_123",
    content="Customer asked for SOC2 evidence and retention policy.",
    kwargs={"source": "python-sdk", "session_id": "demo-session"},
)

result = client.retrieve(
    memory_id="memory_123",
    query="What did customer ask for?",
    custom_kwargs={"k": 3},
)
print(result["results"])
```

---

## MCP-style Helpers

### Local mode

```python
client = MemoryCloudClient(mode="local")
client.record(content="Refactored auth middleware.")
ctx = client.recall_for_task(task="summarize auth changes", limit=8)
print(ctx["results"])
```

### Cloud mode

```python
client = MemoryCloudClient(
    base_url="https://awareness.market/api/v1",
    api_key="YOUR_API_KEY",
)

# Record a single step
client.record(memory_id="memory_123", content="Refactored auth middleware and added tests.")

# Record multiple steps at once
client.record(
    memory_id="memory_123",
    content=[
        "Completed migration patch for user aliases.",
        "Risk: API key owner mismatch can cause tenant leakage.",
    ],
)

# Record knowledge-scoped content
client.record(memory_id="memory_123", content="JWT decision doc", scope="knowledge")

ctx = client.recall_for_task(memory_id="memory_123", task="summarize latest auth changes", limit=8)
print(ctx["results"])
```

---

## Framework Integrations

### LangChain

```python
from memory_cloud import MemoryCloudClient
from memory_cloud.integrations.langchain import MemoryCloudLangChain
import openai

# Local mode (no API key needed)
client = MemoryCloudClient(mode="local")
mc = MemoryCloudLangChain(client=client)

# Cloud mode (team collaboration, semantic search, multi-device sync)
client = MemoryCloudClient(base_url="https://awareness.market/api/v1", api_key="YOUR_API_KEY")
mc = MemoryCloudLangChain(client=client, memory_id="memory_123")

mc.wrap_llm(openai.OpenAI())
retriever = mc.as_retriever()
docs = retriever._get_relevant_documents("What did we decide yesterday?")
```

### CrewAI

```python
from memory_cloud import MemoryCloudClient
from memory_cloud.integrations.crewai import MemoryCloudCrewAI
import openai

# Local mode (no API key needed)
client = MemoryCloudClient(mode="local")
mc = MemoryCloudCrewAI(client=client)

# Cloud mode (team collaboration, semantic search, multi-device sync)
client = MemoryCloudClient(base_url="https://awareness.market/api/v1", api_key="YOUR_API_KEY")
mc = MemoryCloudCrewAI(client=client, memory_id="memory_123")

mc.wrap_llm(openai.OpenAI())
result = mc.memory_search("What happened?")
```

### PraisonAI

```python
from memory_cloud import MemoryCloudClient
from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI
import openai

# Local mode (no API key needed)
client = MemoryCloudClient(mode="local")
mc = MemoryCloudPraisonAI(client=client)

# Cloud mode (team collaboration, semantic search, multi-device sync)
client = MemoryCloudClient(base_url="https://awareness.market/api/v1", api_key="YOUR_API_KEY")
mc = MemoryCloudPraisonAI(client=client, memory_id="memory_123")

mc.wrap_llm(openai.OpenAI())
tools = mc.build_tools()
```

### AutoGen / AG2

```python
from memory_cloud import MemoryCloudClient
from memory_cloud.integrations.autogen import MemoryCloudAutoGen

# Local mode (no API key needed)
client = MemoryCloudClient(mode="local")
mc = MemoryCloudAutoGen(client=client)

# Cloud mode (team collaboration, semantic search, multi-device sync)
client = MemoryCloudClient(base_url="https://awareness.market/api/v1", api_key="YOUR_API_KEY")
mc = MemoryCloudAutoGen(client=client, memory_id="memory_123")

mc.inject_into_agent(assistant)
mc.register_tools(caller=assistant, executor=user_proxy)
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

```python
result = client.record(memory_id, content="Decided to use RS256 for JWT signing", insights={
    "knowledge_cards": [{"title": "JWT signing", "category": "decision", "summary": "Use RS256"}]
})
if result.get("perception"):
    for signal in result["perception"]:
        print(f"[{signal['type']}] {signal['message']}")
        # [pattern] This is the 4th 'decision' card -- recurring theme
        # [resonance] Similar past experience: "JWT auth migration"
```

---

## API Coverage

`MemoryCloudClient` includes:

- Memory: `create_memory`, `list_memories`, `get_memory`, `update_memory`, `delete_memory`
- Content: `write`, `list_memory_content`, `delete_memory_content`
- Retrieval/Chat: `retrieve`, `chat`, `chat_stream`, `memory_timeline`
- MCP ingest: `ingest_events`, `record`
- Export: `export_memory_package`, `save_export_memory_package`
- Async jobs & upload: `get_async_job_status`, `upload_file`, `get_upload_job_status`
- Insights/API keys/wizard: `insights`, `create_api_key`, `list_api_keys`, `revoke_api_key`, `memory_wizard`

---

## Read Exported Packages

```python
from memory_cloud import read_export_package

parsed = read_export_package("memory_export.zip")
print(parsed["manifest"])
print(len(parsed["chunks"]))
print(bool(parsed["safetensors"]))
print(parsed.get("kv_summary"))
```

Readers: `read_export_package(path)`, `read_export_package_bytes(bytes)`, `parse_jsonl_bytes(bytes)`

---

## Examples

- Basic flow: `examples/basic_flow.py`
- Export + read package: `examples/export_and_read.py`
- LangChain e2e (real cloud API): `examples/e2e_langchain_cloud.py`
- CrewAI e2e (real cloud API): `examples/e2e_crewai_cloud.py`
- PraisonAI e2e (real cloud API): `examples/e2e_praisonai_cloud.py`
- AutoGen e2e (real cloud API): `examples/e2e_autogen_cloud.py`

## End-to-End (Real Cloud API)

```bash
export AWARENESS_API_BASE_URL="https://awareness.market/api/v1"
export AWARENESS_API_KEY="aw_xxx"
export AWARENESS_OWNER_ID="your-owner-id"

python examples/e2e_langchain_cloud.py
```

---

## What makes Awareness different

Most memory systems pick one extraction strategy. Awareness combines them:

- **Hybrid retrieval by default** — BM25 full-text + vector cosine + knowledge-graph 1-hop expansion, fused with Reciprocal Rank Fusion. 95.6% R@5 on LongMemEval, zero LLM calls on the retrieval side.
- **Salience-aware extraction** — the client's own LLM self-scores every card on `novelty` / `durability` / `specificity`; cards below 0.4 on novelty or durability are dropped server-side. Framework metadata (`Sender (untrusted metadata)`, `turn_brief`) is filtered before extraction runs.
- **Project isolation** — `X-Awareness-Project-Dir` header scopes memory per project.
- **Zero-LLM backend** — all extraction runs on your LLM (Claude, GPT-4, Gemini, local Llama). The backend is a coordinator + storage layer; no inference costs pass through to you.
- **One memory, many clients** — same data reachable via Claude Code, OpenClaw, npm / pip / ClawHub, MCP server.

See [`docs/analysis/MEMPALACE_COMPARISON_2026-04-17.md`](https://github.com/edwin-hao-ai/Awareness/blob/main/docs/analysis/MEMPALACE_COMPARISON_2026-04-17.md) for the honest side-by-side against MemPalace.
