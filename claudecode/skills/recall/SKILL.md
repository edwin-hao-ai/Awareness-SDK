---
name: recall
description: Search Awareness memory for past implementations, decisions, or relevant context.
user-invokable: true
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

2. Call MCP tool `awareness_recall` with:
   - memory_id: value of env var AWARENESS_MEMORY_ID
   - semantic_query: the expanded natural-language question
   - keyword_query: the extracted precise terms
   - limit: 12

3. Present results clearly, highlighting:
   - Existing implementations that can be reused (include file paths if mentioned)
   - Architectural decisions already made (avoid re-deciding)
   - Related past work and outcomes
   - Any warnings or known issues discovered previously

Rules:
- If results are empty or not relevant, say so clearly — do not hallucinate context
- Do not dump raw JSON — summarize in plain language
