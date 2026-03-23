# Awareness Memory SDK — Python

[![PyPI](https://img.shields.io/pypi/v/awareness-memory-cloud?color=00d4ff)](https://pypi.org/project/awareness-memory-cloud/) [![Discord](https://img.shields.io/discord/1354000000000000000?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.com/invite/nMDrT538Qa)

Python SDK for adding persistent memory to AI agents and apps.

Online docs: <https://awareness.market/docs?doc=python>

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
