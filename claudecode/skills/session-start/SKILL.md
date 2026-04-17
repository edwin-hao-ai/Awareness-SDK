---
name: session-start
description: Initialize memory session, load project context, and create a session_id for tracking.
user-invocable: true
disable-model-invocation: false
---

Initialize Awareness Memory session and load project context.

## How to call Awareness tools

Try MCP tools first (`awareness_init`, `awareness_recall`, `awareness_record`, `awareness_lookup`).
If MCP tools are NOT available, use Bash to call the local daemon HTTP API directly:

```bash
# awareness_init — fresh session, no prior-session noise (default max_sessions=0)
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_init","arguments":{"source":"claude-code"}}}'

# awareness_init — resume/continuity mode, include last N session summaries
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_init","arguments":{"source":"claude-code","max_sessions":3}}}'

# awareness_recall — pass ONE query string, daemon picks the rest
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_recall","arguments":{"query":"<natural-language question>","limit":10}}}'

# awareness_record — pass ONE content string (action=remember is implied)
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_record","arguments":{"content":"<detailed description>","insights":{"knowledge_cards":[...],"action_items":[...],"risks":[...]}}}}'
```

The response is JSON-RPC: `result.content[0].text` contains the tool output as JSON string.

## Steps

1. Call `awareness_init` with source: "claude-code".
   - Default mode (fresh session): `awareness_init({ source: "claude-code" })` — no prior-session summaries in payload, saves ~500-1000 prompt tokens for brand-new tasks.
   - Resume mode: `awareness_init({ source: "claude-code", max_sessions: 3 })` — adds last 3 session summaries for explicit continuity ("continue where we left off").
   - Heuristic: if $ARGUMENTS mentions "continue / resume / yesterday / last time", use resume mode.

2. Store the returned session_id for use in subsequent awareness_record calls.

3. If $ARGUMENTS is provided, also call `awareness_recall` with a single parameter:
   - `query`: expand $ARGUMENTS into a full natural-language question (daemon picks scope/mode/detail automatically)

4. If the response contains `_setup_action`, you MUST follow the instruction to write workflow rules to the specified file.

5. **ATTENTION PROTOCOL**: If `context.attention_summary.needs_attention` is true:
   - Review all stale tasks (pending > 3 days) and high risks
   - Proactively warn the user about high risks before starting work
   - Suggest resolving or removing stale tasks

6. Present a concise summary (3-5 bullet points):
   - **User preferences first** (from `user_preferences`): show key user identity, tech stack preferences, and communication style
   - What was accomplished recently (from context.recent_days)
   - Current open tasks ordered by priority
   - Any relevant knowledge cards
   - Relevant search results if a query was provided
   - If `active_skills` is present, list the activated skills by name

7. If `active_skills` is present, apply each skill's `summary` as behavioral guidance for the session.

8. **Skill Outcome Feedback**: After applying any active skill during this session, call
   `awareness_mark_skill_used(skill_id, outcome)` with one of:
   - `"success"` — skill worked as expected (resets decay, boosts confidence)
   - `"partial"` — skill partially helped (reduced decay boost)
   - `"failed"` — skill didn't work (decreases confidence; 3+ failures → needs_review)

Rules:
- Do not dump raw JSON — summarize in plain language
- Be brief and actionable, not exhaustive
- If no memory found, say so and suggest using /awareness-memory:save after this session
