# Awareness SDK

Official SDKs and plugins for [Awareness Memory Cloud](https://awareness.market) — persistent, cross-session memory for AI agents.

## SDKs

### Python SDK

```bash
pip install awareness-memory-cloud
```

```python
from memory_cloud import MemoryCloudClient

client = MemoryCloudClient(
    base_url="https://awareness.market/api/v1",
    api_key="aw_your-api-key",
)

session = client.begin_memory_session(
    memory_id="your-memory-id",
    source="python-sdk",
)
session.add_event(role="user", content="Hello!")
session.add_event(role="assistant", content="Hi there!")
session.flush()
```

[Full documentation](python/README.md) | [PyPI](https://pypi.org/project/awareness-memory-cloud/)

### TypeScript SDK

```bash
npm install @awareness/memory-cloud-sdk
```

```typescript
import { MemoryCloudClient } from "@awareness/memory-cloud-sdk";

const client = new MemoryCloudClient({
  baseUrl: "https://awareness.market/api/v1",
  apiKey: "aw_your-api-key",
});

const session = client.beginMemorySession({
  memoryId: "your-memory-id",
  source: "typescript-sdk",
});
session.addEvent({ role: "user", content: "Hello!" });
session.addEvent({ role: "assistant", content: "Hi!" });
await session.flush();
```

[Full documentation](typescript/README.md) | [npm](https://www.npmjs.com/package/@awareness/memory-cloud-sdk)

## Plugins

### Claude Code Plugin

Persistent cross-session memory for Claude Code.

```bash
claude plugin install -l ./claudecode
```

Skills: `/awareness-memory:session-start`, `/awareness-memory:recall`, `/awareness-memory:save`, `/awareness-memory:done`

[Full documentation](claudecode/README.md)

### OpenClaw Plugin

Memory plugin for [OpenClaw](https://openclaw.ai) agents.

```bash
openclaw plugins install @awareness/openclaw-memory
```

[Full documentation](openclaw/README.md) | [npm](https://www.npmjs.com/package/@awareness/openclaw-memory)

## Environment Variables

All SDKs and plugins share the same environment variable naming:

| Variable | Description | Default |
|----------|-------------|---------|
| `AWARENESS_API_BASE_URL` | API endpoint | `https://awareness.market/api/v1` |
| `AWARENESS_MCP_URL` | MCP endpoint | `https://awareness.market/mcp` |
| `AWARENESS_API_KEY` | API key (`aw_...`) | — |
| `AWARENESS_MEMORY_ID` | Memory ID | — |
| `AWARENESS_AGENT_ROLE` | Agent role filter | — |

## Publishing

### Python SDK → PyPI

```bash
cd python
pip install build twine
python -m build
twine upload dist/*
```

Or via CI: push a `v*` tag to trigger `.github/workflows/release.yml`.

### TypeScript SDK → npm

```bash
cd typescript
npm run build
npm publish --access public
```

Or via CI: push a `v*` tag to trigger `.github/workflows/release.yml`.

### OpenClaw Plugin → npm

```bash
cd openclaw
npm run build
npm publish --access public
```

### Claude Code Plugin

Install locally or publish to Claude Code marketplace:

```bash
claude plugin install -l ./claudecode
```

## Contributing

SDK source lives in the main [Awareness](https://github.com/edwin-hao-ai/Awareness) repository under `sdks/`. This public repo is auto-synced on every push.

## License

Apache 2.0
