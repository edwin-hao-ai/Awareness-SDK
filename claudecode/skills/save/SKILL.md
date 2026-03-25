---
name: save
description: Save current session progress to Awareness memory as a batch of structured steps.
user-invocable: true
---

Save current session progress to Awareness Memory.

Focus (optional): $ARGUMENTS

## How to call Awareness tools

Try MCP tools first (`awareness_init`, `awareness_recall`, `awareness_record`, `awareness_lookup`).
If MCP tools are NOT available, use Bash to call the local daemon HTTP API directly:

```bash
# awareness_record (single)
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_record","arguments":{"action":"remember","content":"...","insights":{"knowledge_cards":[...],"action_items":[...],"risks":[...]}}}}'

# awareness_record (batch)
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_record","arguments":{"action":"remember_batch","items":[{"content":"step 1..."},{"content":"step 2..."}],"insights":{"knowledge_cards":[...],"action_items":[...],"risks":[...]}}}}'
```

The response is JSON-RPC: `result.content[0].text` contains the tool output as JSON string.

## Steps

1. Gather context about what happened in this session.

2. Extract structured insights from the session:
   - knowledge_cards: key facts, decisions, patterns learned (each with category, title, summary, confidence)
   - action_items: pending tasks, TODOs, blockers (each with title, description, priority)
   - risks: potential issues, concerns discovered (each with title, description, severity)
   - completed_tasks: if awareness_init returned open_tasks, check which ones were completed (each with task_id, reason)

3. Call `awareness_record` with:
   - action: "remember_batch"
   - items: array of content strings covering:
     a. "Session summary: [what was accomplished]"
     b. "Files changed: [list relative paths]"
     c. "Decisions: [key choices made and why]"
     d. "Blockers: [unresolved issues]"
     e. "Next session: [recommended starting point]"
   - insights: the structured object from step 2
   - session_id: from awareness_init (if available)

4. Confirm what was saved.

Rules:
- If $ARGUMENTS is provided, focus the summary on that area
- Always include file paths for modified code
- Write detailed content — include reasoning, alternatives, key code snippets
- Always include insights — this is faster and more accurate than server-side extraction
