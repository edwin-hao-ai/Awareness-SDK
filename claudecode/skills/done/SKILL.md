---
name: done
description: End the current Awareness memory session and save final progress.
user-invocable: true
disable-model-invocation: false
---

End the current Awareness Memory session.

The memory_id is in environment variable AWARENESS_MEMORY_ID.

Steps:
1. Save any unsaved session progress by calling MCP tool `awareness_record` with:
   - action: "remember_batch"
   - memory_id: value of env var AWARENESS_MEMORY_ID
   - session_id: the session_id from awareness_init (if available)
   - steps: array summarizing what was done (same format as /awareness-memory:save)

2. Check if the response contains `_extraction_instruction`:
   - If YES: read the System Prompt and Events in the instruction, process them with your LLM
     to extract structured insights (knowledge_cards, risks, action_items), then call:
     `awareness_record(action="submit_insights", content=<the_json_result>)`
   - If NO: skip this step

3. Report what happened:
   - Session progress saved
   - Whether insights were extracted and submitted
   - Note: insight extraction happens automatically on every write — no explicit session close needed

Rules:
- If no session_id is available, inform user to start a session first with /awareness-memory:session-start
- Always save progress (step 1)
- Never skip _extraction_instruction processing — skipping causes permanent knowledge loss
