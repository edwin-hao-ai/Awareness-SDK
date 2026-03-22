---
name: save
description: Save current session progress to Awareness memory as a batch of structured steps.
user-invocable: true
---

Save current session progress to Awareness Memory.

Focus (optional): $ARGUMENTS

The memory_id is in environment variable AWARENESS_MEMORY_ID.

Steps:
1. Gather context about what happened in this session.

2. Extract structured insights from the session context gathered in step 1:
   - knowledge_cards: key facts, decisions, patterns learned (each with category, title, summary)
   - action_items: pending tasks, TODOs, blockers (each with title, description, priority)
   - risks: potential issues, concerns discovered (each with title, description, severity)
   - completed_tasks: if awareness_init returned open_tasks, check which ones were completed in this session (each with task_id, reason)

3. Call MCP tool `awareness_record` with:
   - content: an array of objects, each with "content" field, covering:
     a. "Session summary: [what was accomplished]"
     b. "Files changed: [list relative paths of modified files]"
     c. "Tests: [what tests were added, modified, or are currently failing]"
     d. "Decisions: [key architectural or implementation choices made and why]"
     e. "Blockers: [any unresolved issues or dependencies]"
     f. "TODOs: [what remains to be done next session]"
     g. "Next session: [recommended starting point and first action]"
   - insights: the structured object from step 2, with knowledge_cards, action_items, risks, completed_tasks
   - memory_id: value of env var AWARENESS_MEMORY_ID
   - session_id: the session_id from awareness_init (if available)

4. Confirm what was saved.

Rules:
- If $ARGUMENTS is provided, focus the summary on that specific area
- Always include file paths for any code that was written or modified
- Write detailed content — include reasoning, alternatives considered, key code snippets, user quotes, and files changed. Do NOT compress into single-line summaries
- Always include insights in the call — this is faster and more accurate than server-side extraction
