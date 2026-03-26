# @awareness-sdk/local

[![npm](https://img.shields.io/npm/v/@awareness-sdk/local?color=7b68ee)](https://www.npmjs.com/package/@awareness-sdk/local) [![Discord](https://img.shields.io/discord/1354000000000000000?color=5865F2&logo=discord&logoColor=white&label=Discord)](https://discord.com/invite/nMDrT538Qa)

Local-first AI agent memory system. No account needed.

## Install

```bash
npm install -g @awareness-sdk/local
```

## Quick Start

```bash
# Start the local daemon
awareness-local start
```

```javascript
import { record, retrieve } from "@awareness-sdk/local/api";

await record({ content: "Refactored auth middleware." });
const result = await retrieve({ query: "What did we refactor?" });
console.log(result.results);
```

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

```javascript
const result = await awareness_record({
  action: "remember",
  content: "Decided to use RS256 for JWT signing",
  insights: { knowledge_cards: [{ title: "JWT signing", category: "decision", summary: "..." }] }
});

if (result.perception) {
  for (const signal of result.perception) {
    console.log(`[${signal.type}] ${signal.message}`);
    // [pattern] This is the 4th 'decision' card -- recurring theme
    // [resonance] Similar past experience: "JWT auth migration"
  }
}
```

## License

Apache-2.0
