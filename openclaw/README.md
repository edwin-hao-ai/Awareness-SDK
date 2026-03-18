# @awareness-sdk/openclaw-memory

OpenClaw memory plugin backed by Awareness Memory Cloud.

Online docs: <https://awareness.market/docs?doc=openclaw>

## Installation

```bash
openclaw plugins install @awareness-sdk/openclaw-memory
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
      "memory": "memory-awareness"
    },
    "entries": {
      "memory-awareness": {
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

## Verification

```bash
openclaw plugins list
```

You should see `memory-awareness` loaded.

## License

Apache-2.0
