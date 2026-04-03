# @awareness-sdk/openclaw-memory

[![npm](https://img.shields.io/npm/v/@awareness-sdk/openclaw-memory?color=7b68ee)](https://www.npmjs.com/package/@awareness-sdk/openclaw-memory) [![Discord](https://img.shields.io/discord/1354000000000000000?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.com/invite/nMDrT538Qa)

OpenClaw memory plugin backed by Awareness Memory Cloud.

Online docs: <https://awareness.market/docs?doc=openclaw>

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

## License

Apache-2.0
