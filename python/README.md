# Awareness Memory Cloud Python SDK

Python SDK for Awareness Memory Cloud APIs and MCP-style memory workflows.

Online docs: <https://awareness.market/docs?doc=python>

## Install

```bash
pip install awareness-memory-cloud
```

Local development:

```bash
cd python
pip install -e .
```

Framework extras:

```bash
# LangChain adapter
pip install -e ".[langchain]"

# CrewAI adapter
pip install -e ".[crewai]"

# AutoGen adapter
pip install -e ".[autogen]"

# Common framework bundle
pip install -e ".[frameworks]"
```

## Quickstart

### Local mode (no API key or memory ID needed)

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
    base_url=os.getenv("AWARENESS_API_BASE_URL", os.getenv("AWARENESS_BASE_URL", "https://awareness.market/api/v1")),
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

### Prompt-Only Injection Quickstart

```python
import os
from memory_cloud import bootstrap_openai_injected_session

owner_id = os.getenv("AWARENESS_OWNER_ID", os.getenv("SDK_DEMO_USER_ID", "test-user"))
user_id = os.getenv("SDK_DEMO_USER_ID", owner_id)

session = bootstrap_openai_injected_session(
    owner_id=owner_id,
    user_id=user_id,
    agent_role="assistant",
)

resp = session.openai_client.chat.completions.create(
    model=os.getenv("AI_GATEWAY_MODEL", "alibaba/qwen-3-14b"),
    messages=[{"role": "user", "content": "Summarize decisions, todos, and risks."}],
)
print(session.memory_id)
print(resp.choices[0].message.content)
```

## API Coverage (SDK/API aligned)

`MemoryCloudClient` now includes:

- Memory: `create_memory`, `list_memories`, `get_memory`, `update_memory`, `delete_memory`
- Content: `write`, `list_memory_content`, `delete_memory_content`
- Retrieval/Chat: `retrieve`, `chat`, `chat_stream`, `memory_timeline`
- MCP ingest: `ingest_events`, `record`
- Export: `export_memory_package`, `save_export_memory_package`
- Async jobs & upload: `get_async_job_status`, `upload_file`, `get_upload_job_status`
- Insights/API keys/wizard: `insights`, `create_api_key`, `list_api_keys`, `revoke_api_key`, `memory_wizard`

## MCP-style Helpers (SDK/MCP aligned, v2.0)

These helpers mirror MCP tool semantics:

- `record` — unified write method (replaces `remember_step`, `remember_batch`, `ingest_content`, `backfill_conversation_history`)
- `recall_for_task`
- `_begin_memory_session` — session auto-managed internally; call directly only for advanced use

Example:

**Local mode** (no API key or memory ID needed):

```python
client = MemoryCloudClient(mode="local")
client.record(content="Refactored auth middleware.")
ctx = client.recall_for_task(task="summarize auth changes", limit=8)
print(ctx["results"])
```

**Cloud mode** (team collaboration, semantic search, multi-device sync):

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

## Read Exported Packages

SDK includes export readers:

- `read_export_package(path)`
- `read_export_package_bytes(bytes)`
- `parse_jsonl_bytes(bytes)`

```python
from memory_cloud import read_export_package

parsed = read_export_package("memory_export.zip")
print(parsed["manifest"])
print(len(parsed["chunks"]))
print(bool(parsed["safetensors"]))
print(parsed.get("kv_summary"))
```

## Examples

- Basic flow: `examples/basic_flow.py`
- Export + read package: `examples/export_and_read.py`
- Prompt-only injected quickstart: `examples/quickstart_injected_minimal.py`
- Injected conversation demo: `examples/injected_conversation_demo.py`
- LangChain e2e (real cloud API): `examples/e2e_langchain_cloud.py`
- CrewAI e2e (real cloud API): `examples/e2e_crewai_cloud.py`
- PraisonAI e2e (real cloud API): `examples/e2e_praisonai_cloud.py`
- AutoGen e2e (real cloud API): `examples/e2e_autogen_cloud.py`

## End-to-End (Real Cloud API)

Set environment variables:

```bash
export AWARENESS_API_BASE_URL="https://awareness.market/api/v1"
# Legacy alias is still supported:
# export AWARENESS_BASE_URL="https://awareness.market/api/v1"
export AWARENESS_API_KEY="aw_xxx"
export AWARENESS_OWNER_ID="your-owner-id"   # only used when auto-creating memory
# export AWARENESS_MEMORY_ID="existing-memory-id"   # optional
```

Run:

```bash
python examples/e2e_langchain_cloud.py
python examples/e2e_crewai_cloud.py
python examples/e2e_praisonai_cloud.py
python examples/e2e_autogen_cloud.py
```

## LangChain

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

## CrewAI

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

## PraisonAI

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

## AutoGen / AG2

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
