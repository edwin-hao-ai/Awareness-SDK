---
name: recall
description: Search Awareness memory for past implementations, decisions, or relevant context.
user-invocable: true
disable-model-invocation: false
---

Search Awareness Memory for relevant context.

Query: $ARGUMENTS

The memory_id is in environment variable AWARENESS_MEMORY_ID.

Steps:
1. REWRITE the user query before calling the tool:
   - SEMANTIC_QUERY: Expand $ARGUMENTS into a full natural-language question with context.
     Example: user says "auth bug" → "authentication bug in login flow, JWT token handling, session management, and OAuth integration"
   - KEYWORD_QUERY: Extract 2-5 precise terms for full-text matching. Use exact identifiers: file names, function names, error codes.
     Example: "auth.py JWT session_cookies OAuth2 login"

2. **Phase 1 — Lightweight index** (recommended for most queries):
   Call MCP tool `awareness_recall` with:
   - memory_id: value of env var AWARENESS_MEMORY_ID
   - semantic_query: the expanded natural-language question
   - keyword_query: the extracted precise terms
   - detail: "summary"
   - Choose appropriate recall_mode based on intent:
     - "hybrid" (default): structured data + vector results in parallel — best for general queries
     - "precise": targeted vector search with chunk reconstruction — best for specific facts
     - "session": expands matched chunks to full session histories — best for "what happened when?"
     - "structured": zero-LLM DB-only lookup — fastest, best for verified knowledge
   - Choose appropriate scope:
     - "all" (default): search everything
     - "timeline": session events, steps, decisions
     - "knowledge": uploaded docs, ingested content
     - "insights": compressed session summaries

3. **Phase 2 — Expand selected items** (only when needed):
   If the summary results contain items that look directly relevant and you need full detail,
   call `awareness_recall` again with:
   - memory_id: same as above
   - semantic_query: same as above
   - detail: "full"
   - ids: list of item IDs from the Phase 1 results that you want to expand
   Skip Phase 2 if the summaries already answer the question sufficiently.

4. Present results clearly, highlighting:
   - Existing implementations that can be reused (include file paths if mentioned)
   - Architectural decisions already made (avoid re-deciding)
   - Related past work and outcomes
   - Any warnings or known issues discovered previously

Rules:
- Use detail="summary" by default — it returns a compact index that is faster and uses fewer tokens
- Only escalate to detail="full" for items that genuinely need the complete content
- If results are empty or not relevant, say so clearly — do not hallucinate context
- Do not dump raw JSON — summarize in plain language
