import { MemoryCloudClient } from "../src";

async function main() {
  // 1) Create client and point it to /api/v1.
  const apiBaseUrl = process.env.AWARENESS_API_BASE_URL || "https://awareness.market/api/v1";
  const client = new MemoryCloudClient({
    baseUrl: apiBaseUrl,
    apiKey: "YOUR_API_KEY",
  });

  // 2) Record a meaningful step (session is managed automatically).
  const step = await client.record({
    memoryId: "your-memory-id",
    content: "Added SDK export parser and MCP-aligned helpers.",
    source: "ts-sdk",
    metadata: { stage: "implementation", tool_name: "typescript" },
  });
  console.log("record:", step);

  // 3) Recall task context and run generic retrieve.
  const recall = await client.recallForTask({
    memoryId: "your-memory-id",
    task: "summarize latest sdk/export changes",
    limit: 5,
  });
  console.log("recallForTask:", recall);

  const retrieve = await client.retrieve({
    memoryId: "your-memory-id",
    query: "What changed for SDK export support?",
    customKwargs: { k: 3 },
  });
  console.log("retrieve:", retrieve);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
