---
name: done
description: End the current Awareness memory session and save final progress.
user-invocable: true
disable-model-invocation: false
---

End the current Awareness Memory session.

## How to call Awareness tools

Try MCP tools first (`awareness_record`).
If MCP tools are NOT available, use Bash to call the local daemon HTTP API directly:

```bash
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_record","arguments":{"action":"remember_batch","items":[{"content":"..."}],"insights":{"knowledge_cards":[...],"action_items":[...],"risks":[...],"completed_tasks":[...]}}}}'
```

The response is JSON-RPC: `result.content[0].text` contains the tool output as JSON string.

## Steps

1. Gather context about this session, then extract structured insights:
   - knowledge_cards: key facts, decisions, patterns (each with category, title, summary)
   - action_items: pending tasks, TODOs (each with title, description, priority)
   - risks: potential issues (each with title, description, severity)
   - completed_tasks: tasks from awareness_init that were completed (each with task_id, reason)

2. Call `awareness_record` with:
   - action: "remember_batch"
   - items: array summarizing what was done (same format as /awareness-memory:save)
   - insights: the structured object from step 1

3. Report what happened:
   - Session progress saved
   - Whether insights were included

Rules:
- Always save with inline insights
- Write detailed content — include reasoning, alternatives, code snippets, files changed
