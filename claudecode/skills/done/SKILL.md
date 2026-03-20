---
name: done
description: End the current Awareness memory session and save final progress.
user-invocable: true
disable-model-invocation: false
---

End the current Awareness Memory session.

The memory_id is in environment variable AWARENESS_MEMORY_ID.

Steps:
1. Gather context about what happened in this session, then extract structured insights:
   - knowledge_cards: key facts, decisions, patterns learned (each with category, title, summary)
   - action_items: pending tasks, TODOs, blockers (each with title, description, priority)
   - risks: potential issues, concerns discovered (each with title, description, severity)

2. Save session progress by calling MCP tool `awareness_record` with:
   - content: array summarizing what was done (same format as /awareness-memory:save)
   - insights: the structured object from step 1, with knowledge_cards, action_items, risks
   - memory_id: value of env var AWARENESS_MEMORY_ID
   - session_id: the session_id from awareness_init (if available)

3. Report what happened:
   - Session progress saved
   - Whether insights were included
   - Note: insight extraction happens automatically on every write — no explicit session close needed

Rules:
- If no session_id is available, inform user to start a session first with /awareness-memory:session-start
- Always save progress with inline insights — this is faster and more accurate than server-side extraction
