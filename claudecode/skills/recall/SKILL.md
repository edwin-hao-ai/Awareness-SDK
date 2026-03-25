---
name: recall
description: Search Awareness memory for past implementations, decisions, or relevant context.
user-invocable: true
disable-model-invocation: false
---

Search Awareness Memory for relevant context.

Query: $ARGUMENTS

## How to call Awareness tools

Try MCP tools first (`awareness_recall`).
If MCP tools are NOT available, use Bash to call the local daemon HTTP API directly:

```bash
# awareness_recall (summary)
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_recall","arguments":{"semantic_query":"...","keyword_query":"...","detail":"summary","limit":10}}}'

# awareness_recall (full, with specific IDs)
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_recall","arguments":{"semantic_query":"...","detail":"full","ids":["id1","id2"]}}}'
```

The response is JSON-RPC: `result.content[0].text` contains the tool output as JSON string.

## Steps

1. REWRITE the user query:
   - SEMANTIC_QUERY: Expand $ARGUMENTS into a full natural-language question with context.
     Example: "auth bug" → "authentication bug in login flow, JWT token handling, session management"
   - KEYWORD_QUERY: Extract 2-5 precise terms. Use exact identifiers: file names, function names, error codes.

2. **Phase 1 — Lightweight index**:
   Call `awareness_recall` with:
   - semantic_query: the expanded question
   - keyword_query: the extracted terms
   - detail: "summary"
   - recall_mode: "hybrid" (default), "precise" (specific facts), "session" (what happened when), or "structured" (DB-only, fastest)

3. **Phase 2 — Expand selected items** (only when needed):
   Call `awareness_recall` again with detail: "full" and ids: [relevant IDs from Phase 1].
   Skip if summaries already answer the question.

4. Present results clearly:
   - Existing implementations that can be reused (include file paths)
   - Architectural decisions already made
   - Related past work and warnings

Rules:
- Use detail="summary" by default
- Only escalate to detail="full" for items that need complete content
- If results are empty, say so clearly — do not hallucinate
- Do not dump raw JSON — summarize in plain language
