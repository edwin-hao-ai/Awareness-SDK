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
# F-053: single-parameter — daemon picks scope/mode/detail/weights.
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_recall","arguments":{"query":"why did we pick pgvector?","limit":10}}}'
```

The response is JSON-RPC: `result.content[0].text` contains the tool output as JSON string.

## Steps

1. REWRITE the user query into a complete natural-language question with context.
   Example: "auth bug" → "authentication bug in login flow, JWT token handling, session management"

2. Call `awareness_recall` with ONE parameter:
   - `query`: the rewritten natural-language question
   - (optional) `limit`: default 6, max 30
   - (optional) `token_budget`: 5K (default, card-heavy) / 30K (mixed) / 60K+ (raw-heavy)

   Daemon auto-routes across memories + knowledge cards + workspace graph and picks
   the right detail level for your token budget. You do NOT need to choose scope,
   recall_mode, detail, ids, or weights.

3. Present results clearly:
   - Existing implementations that can be reused (include file paths)
   - Architectural decisions already made
   - Related past work and warnings

Rules:
- Pass ONE query string — daemon handles the rest.
- If results are empty, say so clearly — do not hallucinate.
- Do not dump raw JSON — summarize in plain language.
