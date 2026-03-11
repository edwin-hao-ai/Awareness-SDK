# @awareness-sdk/openclaw-memory

OpenClaw memory plugin backed by Awareness Memory Cloud. Gives your OpenClaw agent persistent, structured memory across sessions.

## Installation

```bash
openclaw plugins install @awareness-sdk/openclaw-memory
```

## Configuration

Add the plugin to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "memory-awareness": {
      "package": "@awareness-sdk/openclaw-memory",
      "config": {
        "apiKey": "ak-your-awareness-api-key",
        "memoryId": "your-memory-uuid",
        "agentRole": "builder_agent"
      }
    }
  }
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | **required** | Awareness API key |
| `memoryId` | string | **required** | Target memory UUID |
| `baseUrl` | string | `https://awareness.market/api/v1` | Awareness API base URL |
| `agentRole` | string | `builder_agent` | Agent role for scoped recall |
| `autoRecall` | boolean | `true` | Auto-load memory context before each run |
| `autoCapture` | boolean | `true` | Auto-store conversation summary after each run |
| `recallLimit` | integer | `8` | Max results for auto-recall |

## Available Tools

| Tool | Description |
|------|-------------|
| `memory_recall` | Semantic search over stored memories |
| `memory_store` | Persist a single piece of information |
| `memory_forget` | Supersede (soft-delete) a knowledge card |
| `memory_context` | Load full session context (narratives + tasks + cards) |
| `memory_knowledge` | Query structured knowledge cards by category |
| `memory_tasks` | Retrieve pending and in-progress action items |
| `memory_batch` | Store multiple memory steps in one call |

## Auto Features

### Auto Recall (`autoRecall: true`)

When a new agent session starts, the plugin automatically:

1. Fetches structured session context (recent daily narratives, open tasks, knowledge cards)
2. Runs semantic recall against the user prompt
3. Prepends an `<awareness-memory>` XML block to the system prompt

### Auto Capture (`autoCapture: true`)

When an agent session ends, the plugin automatically:

1. Collects meaningful messages from the conversation (filtering out short messages and memory XML tags)
2. Stores a conversation summary in Awareness memory

## Programmatic Usage

You can also use the client directly in your own code:

```typescript
import { AwarenessClient } from "@awareness-sdk/openclaw-memory";

const client = new AwarenessClient(
  "https://awareness.market/api/v1",
  "ak-your-key",
  "memory-uuid",
  "builder_agent",
);

// Recall relevant memories
const results = await client.recallForTask("implement auth system", 5);

// Store a step
await client.rememberStep("Decided to use JWT for authentication");

// Get session context
const context = await client.getSessionContext(10);

// Query knowledge cards
const knowledge = await client.getKnowledgeBase("auth", "decision", 10);
```

## Full Documentation

See the [Awareness SDK Documentation](https://awareness.market/docs/sdk) for complete API reference and advanced usage patterns.

## License

Apache-2.0
