---
name: save
description: Save current session progress to Awareness memory as a batch of structured steps.
user-invocable: true
---

Save current session progress to Awareness Memory.

Focus (optional): $ARGUMENTS

## How to call Awareness tools

Try MCP tools first (`awareness_init`, `awareness_recall`, `awareness_record`, `awareness_lookup`).
If MCP tools are NOT available, use Bash to call the local daemon HTTP API directly:

```bash
# awareness_record (single)
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_record","arguments":{"action":"remember","content":"...","insights":{"knowledge_cards":[...],"action_items":[...],"risks":[...]}}}}'

# awareness_record (batch)
curl -s -X POST http://localhost:37800/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"awareness_record","arguments":{"action":"remember_batch","items":[{"content":"step 1..."},{"content":"step 2..."}],"insights":{"knowledge_cards":[...],"action_items":[...],"risks":[...]}}}}'
```

The response is JSON-RPC: `result.content[0].text` contains the tool output as JSON string.

## Steps

1. Gather context about what happened in this session.

2. Extract structured insights from the session — **salience-aware, not greedy**:

   **Philosophy** (distilled essence, not raw logs): your job is NOT "generate a card for every turn" — it is "identify what's worth recalling in 6 months on a fresh project". Returning empty arrays for `knowledge_cards` is a first-class answer when the session was just tool testing, chatter, or framework metadata.

   - **knowledge_cards**: only genuine insights (each with category, title, summary, confidence, + three 0.0-1.0 scores).
     - **When to extract:**
<!-- SHARED:extraction-when-to-extract BEGIN -->
- The user **made a decision** — chose X over Y, with a stated reason
- A **non-obvious bug was fixed** — symptom + root cause + fix + how to avoid recurring
- A **workflow / convention was established** — ordered steps, preconditions, gotchas
- The user stated a **preference or hard constraint** — "I prefer X", "never do Y"
- A **pitfall was encountered and a workaround found** — trigger + impact + avoidance
- An **important fact about the user or project** surfaced for the first time
<!-- SHARED:extraction-when-to-extract END -->
     - **When NOT to extract:**
<!-- SHARED:extraction-when-not-to-extract BEGIN -->
- **Agent framework metadata**: content beginning with `Sender (untrusted metadata)`,
  `turn_brief`, `[Operational context metadata ...]`, `[Subagent Context]`, or wrapped
  inside `Request:` / `Result:` / `Send:` envelopes that only carry such metadata.
  Strip those wrappers mentally and judge what remains.
- **Greetings / command invocations**: "hi", "run tests", "save this", "try again".
- **"What can you do" / AI self-introduction turns**.
- **Code restatement**: code itself lives in git; only extract the *lesson* if one exists.
- **Test / debug sessions where the user is verifying the tool works** (including tests
  of awareness_record / awareness_recall themselves). A bug fix in those tools IS worth
  extracting as problem_solution; a raw "let me test if recall works" turn is not.
- **Transient status / progress updates** — "building...", "retrying...", "✅ done".

The single question to ask: **"If I start a fresh project 6 months from now, will being
reminded of this content materially help me?"** If not, do not emit a card.
Returning `"knowledge_cards": []` is a **first-class answer** — prefer it over fabricating
a card from low-signal content.
<!-- SHARED:extraction-when-not-to-extract END -->
     - **Per-card scores the daemon enforces:**
<!-- SHARED:extraction-scoring BEGIN -->
Every card you emit MUST carry three LLM self-assessed scores (0.0-1.0):

- `novelty_score`: how new is this vs known facts & existing cards?
  (restating an existing card = 0.1; a fresh decision = 0.9)
- `durability_score`: will this still matter in 6 months? (transient debug state = 0.1;
  architectural decision or user preference = 0.9)
- `specificity_score`: is there concrete substance — file paths, commands, error strings,
  version numbers, exact function names? (vague platitude = 0.1; reproducible recipe = 0.9)

The daemon will discard any card where `novelty_score < 0.4` OR `durability_score < 0.4`.
This is intentional — score honestly. Under-extraction is much better than noise.
<!-- SHARED:extraction-scoring END -->
     - **Structural quality gate (rejects if violated):**
<!-- SHARED:extraction-quality-gate BEGIN -->
Drop the card rather than submit if it would fail any of these:

- **R1 length**: `summary` ≥ 80 chars (technical: decision / problem_solution
  / workflow / pitfall / insight / key_point); ≥ 40 chars (personal:
  personal_preference / important_detail / plan_intention /
  activity_preference / health_info / career_info / custom_misc).
- **R2 no duplication**: `summary` not byte-identical to `title`.
- **R3 no envelope leakage**: neither `title` nor `summary` starts with
  `Request:`, `Result:`, `Send:`, `Sender (untrusted metadata)`,
  `[Operational context metadata`, or `[Subagent Context]`.
- **R4 no placeholder tokens**: `summary` has no `TODO`, `FIXME`,
  `lorem ipsum`, `example.com`, or literal `placeholder`.
- **R5 Markdown on long summaries**: ≥ 200 chars → use bullets /
  `inline code` / **bold**. Soft.

**Recall-friendliness** — without these, a card is "accepted but
invisible" at retrieval time:

- **R6 grep-friendly title**: at least one concrete term you'd search
  for — product (`pgvector`), file (`daemon.mjs`), error, version,
  function (`_submitInsights`), project noun. Vague titles ("Decision
  made", "Bug fixed", "决定") score ~30 % precision@3.
  ❌ "Bug fixed"  ✅ "Fix pgvector dim 1536→1024 mismatch".
- **R7 topic-specific tags**: 3-5 tags, each a specific
  noun/product/concept. Never `general`, `note`, `misc`, `fix`,
  `project`, `tech`. ❌ `["general","note"]`  ✅ `["pgvector","vector-db","cost"]`.
- **R8 multilingual keyword diversity**: concepts that have both EN +
  CJK names → include BOTH in the summary at least once. Example:
  "用 `pgvector` 做向量数据库存储" matches queries in either language.

Rejected cards return in `response.cards_skipped[]`. R6-R8 are
warnings, not blocks — use them to self-critique before submitting.
<!-- SHARED:extraction-quality-gate END -->
   - **skills**: reusable procedures the user runs more than once:
<!-- SHARED:skill-extraction BEGIN -->
A `skill` is a **reusable procedure the user will invoke again** (e.g. "publish
SDK to npm", "regenerate golden snapshots after schema change"). Skills go in
`insights.skills[]`, NOT `insights.knowledge_cards[]`.

Emit a skill when ALL three hold:
1. The content describes a **repeated** procedure (2+ earlier cards mention
   the same steps, or the user explicitly says "this is our workflow for X").
2. There is a **stable trigger** you can name — the task / state that makes
   someone reach for this skill.
3. The steps are **executable without improvisation** — concrete files,
   commands, flags, verification signals. "Do it carefully" fails this bar.

Skip (return empty `skills: []`) for:
- Single debugging incidents → `problem_solution` card instead.
- Generic advice with no concrete steps.
- Configuration snapshots → `important_detail` card instead.

Required shape per skill:
```json
{
  "name": "3-8 words, action-oriented (\"Publish SDK to npm\")",
  "summary": "200-500 chars of second-person imperative — pasteable into an agent prompt. Include WHY in one clause so the agent knows when to deviate.",
  "methods": [{"step": 1, "description": "≥20 chars, names a file/command/verification — no vague verbs"}],
  "trigger_conditions": [{"pattern": "When publishing @awareness-sdk/*", "weight": 0.9}],
  "tags": ["npm", "publish", "release"],
  "reusability_score": 0.0,
  "durability_score": 0.0,
  "specificity_score": 0.0
}
```

The daemon discards any skill with any of the three scores < 0.5 — score
honestly. ≥ 3 steps, ≥ 2 trigger patterns, 3-8 tags.
<!-- SHARED:skill-extraction END -->
   - **action_items**: pending tasks, TODOs, blockers (each with title, description, priority)
   - **risks**: potential issues, concerns discovered (each with title, description, severity)
   - **completed_tasks**: if awareness_init returned open_tasks, check which ones were completed (each with task_id, reason)

3. Call `awareness_record` with:
   - action: "remember_batch"
   - items: array of content strings covering:
     a. "Session summary: [what was accomplished]"
     b. "Files changed: [list relative paths]"
     c. "Decisions: [key choices made and why]"
     d. "Blockers: [unresolved issues]"
     e. "Next session: [recommended starting point]"
   - insights: the structured object from step 2
   - session_id: from awareness_init (if available)

4. Confirm what was saved.

Rules:
- If $ARGUMENTS is provided, focus the summary on that area
- Always include file paths for modified code
- Write detailed content — include reasoning, alternatives, key code snippets
- Always include insights — this is faster and more accurate than server-side extraction
