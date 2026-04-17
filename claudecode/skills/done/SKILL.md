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

1. Gather context about this session, then extract structured insights — **salience-aware, not greedy**:

   **Philosophy** (distilled essence, not raw logs): your job is NOT "generate a card for every turn" — it is "identify what's worth recalling in 6 months on a fresh project". Empty `knowledge_cards: []` is a first-class answer when the session was just tool testing or framework metadata.

   - **knowledge_cards**: only genuine insights (category, title, summary, + three 0.0-1.0 scores: `novelty_score`, `durability_score`, `specificity_score`). Summary = 400-800 char wiki-style Markdown, naturally structured per category.
     - **EXTRACT**: decisions (with reason), non-obvious bug fixes (symptom+root_cause+fix+avoidance), workflows established, preferences/constraints stated, pitfalls + workarounds, important new facts.
     - **DO NOT EXTRACT**: agent framework metadata (`Sender (untrusted metadata)`, `turn_brief`, `[Operational context metadata ...]` — even inside `Request:`/`Result:` envelopes); greetings; pure commands; "what can you do"; code restatement (git has it); test/debug sessions verifying the tool itself; transient status.
     - Cards with `novelty_score < 0.4` OR `durability_score < 0.4` will be discarded by the daemon. Under-extraction beats noise.
     - Do NOT gate on length. A 15-char preference can be more valuable than a 5000-char log.
   - **action_items**: pending tasks, TODOs (each with title, description, priority)
   - **risks**: potential issues (each with title, description, severity)
   - **completed_tasks**: tasks from awareness_init that were completed (each with task_id, reason)

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
