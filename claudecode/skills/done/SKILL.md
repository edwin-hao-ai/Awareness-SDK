---
name: done
description: End the current Awareness memory session and save final progress.
user-invokable: true
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

2. Report what happened:
   - Session progress saved
   - Note: insight extraction happens automatically on every write — no explicit session close needed

Rules:
- If no session_id is available, inform user to start a session first with /awareness-memory:session-start
- Always save progress (step 1)
