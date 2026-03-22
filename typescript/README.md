# Awareness Memory Cloud TypeScript SDK

TypeScript SDK for Awareness Memory Cloud APIs and MCP-style memory workflows.

Online docs: <https://awareness.market/docs?doc=typescript>

## Install

```bash
npm install @awareness-sdk/memory-cloud
```

Local development:

```bash
cd typescript
npm install
npm run build
```

## Quickstart

### Local mode (no API key or memory ID needed)

```ts
import { MemoryCloudClient } from "@awareness-sdk/memory-cloud";

const client = new MemoryCloudClient({ mode: "local" }); // connects to localhost:8765

await client.record({ content: "Refactored auth middleware." });
const result = await client.retrieve({ query: "What did we refactor?" });
console.log(result.results);
```

### Cloud mode

```ts
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

## API Coverage (SDK/API aligned)

`MemoryCloudClient` includes:

- Memory: `createMemory`, `listMemories`, `getMemory`, `updateMemory`, `deleteMemory`
- Content: `write`, `listMemoryContent`, `deleteMemoryContent`
- Retrieval/Chat: `retrieve`, `chat`, `chatStream`, `memoryTimeline`
- MCP ingest: `ingestEvents`, `record` (use `record({ scope: "knowledge" })` instead of `ingestContent`)
- Export: `exportMemoryPackage`
- Async jobs & upload: `getAsyncJobStatus`, `uploadFile`, `getUploadJobStatus`
- Insights/API keys/wizard: `insights`, `createApiKey`, `listApiKeys`, `revokeApiKey`, `memoryWizard`

## MCP-style Helpers (SDK/MCP aligned)

- `recallForTask`
- `record` — unified write (single event, batch, or insights)

**Local mode** (no API key or memory ID needed):

```ts
const client = new MemoryCloudClient({ mode: "local" });

await client.record({ content: "Completed JWT migration." });
const ctx = await client.recallForTask({ task: "summarize auth changes", limit: 8 });
console.log(ctx.results);
```

**Cloud mode** (team collaboration, semantic search, multi-device sync):

```ts
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

## Read Exported Packages

SDK includes export readers:

- `readExportPackage(input)`
- `parseJsonlText(text)`

```ts
import { readExportPackage } from "@awareness-sdk/memory-cloud";

const parsed = await readExportPackage(zipBytes);
console.log(parsed.manifest);
console.log(parsed.chunks.length);
console.log(Boolean(parsed.safetensors));
console.log(parsed.kvSummary);
```

## Examples

- Basic flow: `examples/basic-flow.ts`
- Export + read package: `examples/export-and-read.ts`
