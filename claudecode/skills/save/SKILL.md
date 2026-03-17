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

2. Call MCP tool `awareness_record` with:
   - action: "remember_batch"
   - memory_id: value of env var AWARENESS_MEMORY_ID
   - session_id: the session_id from awareness_init (if available)
   - steps: an array of objects, each with "text" field, covering:
     a. "Session summary: [what was accomplished]"
     b. "Files changed: [list relative paths of modified files]"
     c. "Tests: [what tests were added, modified, or are currently failing]"
     d. "Decisions: [key architectural or implementation choices made and why]"
     e. "Blockers: [any unresolved issues or dependencies]"
     f. "TODOs: [what remains to be done next session]"
     g. "Next session: [recommended starting point and first action]"

3. Check if the response contains `_extraction_instruction`:
   - If YES: read the System Prompt and Events in the instruction, process them with your LLM
     to extract structured insights (knowledge_cards, risks, action_items), then call:
     `awareness_record(action="submit_insights", content=<the_json_result>)`
   - If NO: skip this step

4. Confirm what was saved.

Rules:
- If $ARGUMENTS is provided, focus the summary on that specific area
- Always include file paths for any code that was written or modified
- Include WHAT happened, WHY it matters, OUTCOME, and FILES affected
- Write clearly so the system can auto-extract knowledge cards, tasks, and risks
- Never skip _extraction_instruction processing — skipping causes permanent knowledge loss
