# Awareness Memory Cloud Python SDK

Python SDK for Awareness Memory Cloud APIs and MCP-style memory workflows.

## Install

```bash
pip install awareness-memory-cloud
```

Local development:

```bash
cd sdks/python
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
    model=os.getenv("AI_GATEWAY_MODEL", "meta/llama-3.1-8b"),
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
- MCP ingest: `ingest_events`, `ingest_content`
- Export: `export_memory_package`, `save_export_memory_package`
- Async jobs & upload: `get_async_job_status`, `upload_file`, `get_upload_job_status`
- Insights/API keys/wizard: `insights`, `create_api_key`, `list_api_keys`, `revoke_api_key`, `memory_wizard`

## MCP-style Helpers (SDK/MCP aligned)

These helpers mirror MCP tool semantics:

- `begin_memory_session`
- `recall_for_task`
- `remember_step`
- `remember_batch`
- `backfill_conversation_history`

Example:

```python
session = client.begin_memory_session(memory_id="memory_123", source="python-sdk")
client.remember_step(
    memory_id="memory_123",
    text="Refactored auth middleware and added tests.",
)
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
- LangChain retriever: `examples/langchain_retriever.py`
- CrewAI tools: `examples/crewai_tools.py`
- PraisonAI toolkit: `examples/praisonai_toolkit.py`
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

client = MemoryCloudClient(base_url="https://awareness.market/api/v1", api_key="YOUR_API_KEY")
mc = MemoryCloudLangChain(client=client, memory_id="memory_123")

# Injection: wrap the LLM client
import openai
mc.wrap_llm(openai.OpenAI())

# Or use as a LangChain Retriever
retriever = mc.as_retriever()
docs = retriever._get_relevant_documents("What did we decide yesterday?")
```

## CrewAI

```python
from memory_cloud import MemoryCloudClient
from memory_cloud.integrations.crewai import MemoryCloudCrewAI

client = MemoryCloudClient(base_url="https://awareness.market/api/v1", api_key="YOUR_API_KEY")
mc = MemoryCloudCrewAI(client=client, memory_id="memory_123")

# Injection: wrap the LLM client
import openai
mc.wrap_llm(openai.OpenAI())

# Or use explicit tools
result = mc.memory_search("What happened?")
```

## PraisonAI

```python
from memory_cloud import MemoryCloudClient
from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

client = MemoryCloudClient(base_url="https://awareness.market/api/v1", api_key="YOUR_API_KEY")
mc = MemoryCloudPraisonAI(client=client, memory_id="memory_123")

# Injection: wrap the LLM client
import openai
mc.wrap_llm(openai.OpenAI())

# Or get tool dicts for PraisonAI agent config
tools = mc.build_tools()
```

## AutoGen / AG2

```python
from memory_cloud import MemoryCloudClient
from memory_cloud.integrations.autogen import MemoryCloudAutoGen

client = MemoryCloudClient(base_url="https://awareness.market/api/v1", api_key="YOUR_API_KEY")
mc = MemoryCloudAutoGen(client=client, memory_id="memory_123")

# Injection: hook into agent message processing
mc.inject_into_agent(assistant)

# Or register explicit tools
mc.register_tools(caller=assistant, executor=user_proxy)
```
