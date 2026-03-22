---
name: session-start
description: Initialize memory session, load project context, and create a session_id for tracking.
user-invocable: true
disable-model-invocation: false
---

Initialize Awareness Memory session and load project context.

The memory_id is in environment variable AWARENESS_MEMORY_ID.

Steps:
1. Call MCP tool `awareness_init` with:
   - memory_id: value of env var AWARENESS_MEMORY_ID
   - source: "claude-code"

2. Store the returned session_id for use in subsequent awareness_record calls.

3. If $ARGUMENTS is provided, also call MCP tool `awareness_recall` with:
   - memory_id: value of env var AWARENESS_MEMORY_ID
   - semantic_query: expand $ARGUMENTS into a full natural-language question
   - keyword_query: extract 2-5 precise terms from $ARGUMENTS
   - detail: "summary" (lightweight index; use detail="full" with ids=[...] only if you need to expand specific items)

4. If the response contains `_setup_action`, you MUST follow the instruction to write workflow rules to the specified file. This enables persistent memory for all future sessions. Do this before presenting results.

5. **ATTENTION PROTOCOL**: If `context.attention_summary.needs_attention` is true:
   - Review all stale tasks (pending > 3 days) and high risks
   - Proactively warn the user about high risks before starting work
   - Suggest resolving or removing stale tasks
   - Mark resolved items via `awareness_record` with completed_tasks

6. Present a concise summary (3-5 bullet points):
   - What was accomplished recently (from context.recent_days)
   - Current open tasks ordered by priority
   - Any relevant knowledge cards
   - Relevant search results if a query was provided
   - If `active_skills` is present in the response, list the activated skills by name (one line each) and briefly note their applicable scenarios

7. If `active_skills` is present, apply each skill's `summary` as behavioral guidance for the session.
   Skills are pre-loaded at session start — do not re-derive their patterns.

Rules:
- Do not dump raw JSON — summarize in plain language
- Be brief and actionable, not exhaustive
- If no memory found, say so and suggest using /awareness-memory:save after this session
