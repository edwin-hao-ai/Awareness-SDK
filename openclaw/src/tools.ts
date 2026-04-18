import type { PluginApi, PerceptionSignal } from "./types";
import type { AwarenessClient } from "./client";
import * as fs from "fs";
import * as path from "path";
import { syncRecordToOpenClaw } from "./sync";

// Cache perception signals for next auto-recall injection
function cachePerception(signals: PerceptionSignal[]): void {
  if (!signals || signals.length === 0) return;
  try {
    const cacheFile = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".awareness",
      "perception-cache.json",
    );
    const dir = path.dirname(cacheFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let existing: Array<PerceptionSignal & { _ts?: number }> = [];
    try { existing = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { /* empty */ }
    const updated = [
      ...signals.map((s) => ({ ...s, _ts: Date.now() })),
      ...existing,
    ].slice(0, 10);
    fs.writeFileSync(cacheFile, JSON.stringify(updated), "utf8");
  } catch { /* best-effort */ }
}

const LEGACY_FULL_TEXT_WEIGHT_KEY = ["full", "_text", "_weight"].join("");

// ---------------------------------------------------------------------------
// Register 6 OpenClaw tools backed by the Awareness REST API
// ---------------------------------------------------------------------------

export function registerTools(api: PluginApi, client: AwarenessClient): void {
  // -----------------------------------------------------------------------
  // 0. __awareness_workflow__ — workflow checklist (callable)
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "__awareness_workflow__",
    name: "__awareness_workflow__",
    description:
      "Call this when you're unsure what to do next with Awareness memory tools.\n" +
      "Returns a step-by-step checklist so you always know the right next action.\n" +
      "Low-cost call — use it anytime you need a reminder of the workflow.",
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      workflow: [
        { step: 1, action: "awareness_init", when: "FIRST thing every session", what: "Get session_id + past context + active_skills[]" },
        { step: 2, action: "awareness_recall", when: "BEFORE starting work", what: 'Single-parameter: awareness_recall(query="<natural-language question>")' },
        { step: 3, action: "awareness_record", when: "AFTER every change", what: 'Single-parameter: awareness_record(content="<detailed description with reasoning, code snippets, files changed>")' },
        { step: 4, action: "handle _extraction_instruction", when: "response contains _extraction_instruction", what: `Salience-aware extraction. Your job is NOT "generate a card for every turn" — it is "identify the distilled essence worth recalling in 6 months". Returning empty arrays is a first-class answer.
<!-- SHARED:extraction-when-to-extract BEGIN -->
- The user **made a decision** — chose X over Y, with a stated reason
- A **non-obvious bug was fixed** — symptom + root cause + fix + how to avoid recurring
- A **workflow / convention was established** — ordered steps, preconditions, gotchas
- The user stated a **preference or hard constraint** — "I prefer X", "never do Y"
- A **pitfall was encountered and a workaround found** — trigger + impact + avoidance
- An **important fact about the user or project** surfaced for the first time
<!-- SHARED:extraction-when-to-extract END -->
<!-- SHARED:extraction-when-not-to-extract BEGIN -->
- **Agent framework metadata**: content beginning with \`Sender (untrusted metadata)\`,
  \`turn_brief\`, \`[Operational context metadata ...]\`, \`[Subagent Context]\`, or wrapped
  inside \`Request:\` / \`Result:\` / \`Send:\` envelopes that only carry such metadata.
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
Returning \`"knowledge_cards": []\` is a **first-class answer** — prefer it over fabricating
a card from low-signal content.
<!-- SHARED:extraction-when-not-to-extract END -->
<!-- SHARED:extraction-scoring BEGIN -->
Every card you emit MUST carry three LLM self-assessed scores (0.0-1.0):

- \`novelty_score\`: how new is this vs known facts & existing cards?
  (restating an existing card = 0.1; a fresh decision = 0.9)
- \`durability_score\`: will this still matter in 6 months? (transient debug state = 0.1;
  architectural decision or user preference = 0.9)
- \`specificity_score\`: is there concrete substance — file paths, commands, error strings,
  version numbers, exact function names? (vague platitude = 0.1; reproducible recipe = 0.9)

The daemon will discard any card where \`novelty_score < 0.4\` OR \`durability_score < 0.4\`.
This is intentional — score honestly. Under-extraction is much better than noise.
<!-- SHARED:extraction-scoring END -->
<!-- SHARED:extraction-quality-gate BEGIN -->
Drop the card rather than submit if it would fail any of these:

- **R1 length**: \`summary\` ≥ 80 chars (technical: decision / problem_solution
  / workflow / pitfall / insight / key_point); ≥ 40 chars (personal:
  personal_preference / important_detail / plan_intention /
  activity_preference / health_info / career_info / custom_misc).
- **R2 no duplication**: \`summary\` not byte-identical to \`title\`.
- **R3 no envelope leakage**: neither \`title\` nor \`summary\` starts with
  \`Request:\`, \`Result:\`, \`Send:\`, \`Sender (untrusted metadata)\`,
  \`[Operational context metadata\`, or \`[Subagent Context]\`.
- **R4 no placeholder tokens**: \`summary\` has no \`TODO\`, \`FIXME\`,
  \`lorem ipsum\`, \`example.com\`, or literal \`placeholder\`.
- **R5 Markdown on long summaries**: ≥ 200 chars → use bullets /
  \`inline code\` / **bold**. Soft.

**Recall-friendliness** — without these, a card is "accepted but
invisible" at retrieval time:

- **R6 grep-friendly title**: at least one concrete term you'd search
  for — product (\`pgvector\`), file (\`daemon.mjs\`), error, version,
  function (\`_submitInsights\`), project noun. Vague titles ("Decision
  made", "Bug fixed", "决定") score ~30 % precision@3.
  ❌ "Bug fixed"  ✅ "Fix pgvector dim 1536→1024 mismatch".
- **R7 topic-specific tags**: 3-5 tags, each a specific
  noun/product/concept. Never \`general\`, \`note\`, \`misc\`, \`fix\`,
  \`project\`, \`tech\`. ❌ \`["general","note"]\`  ✅ \`["pgvector","vector-db","cost"]\`.
- **R8 multilingual keyword diversity**: concepts that have both EN +
  CJK names → include BOTH in the summary at least once. Example:
  "用 \`pgvector\` 做向量数据库存储" matches queries in either language.

Rejected cards return in \`response.cards_skipped[]\`. R6-R8 are
warnings, not blocks — use them to self-critique before submitting.
<!-- SHARED:extraction-quality-gate END -->
<!-- SHARED:skill-extraction BEGIN -->
A \`skill\` is a **reusable procedure the user will invoke again** (e.g. "publish
SDK to npm", "regenerate golden snapshots after schema change"). Skills go in
\`insights.skills[]\`, NOT \`insights.knowledge_cards[]\`.

Emit a skill when ALL three hold:
1. The content describes a **repeated** procedure (2+ earlier cards mention
   the same steps, or the user explicitly says "this is our workflow for X").
2. There is a **stable trigger** you can name — the task / state that makes
   someone reach for this skill.
3. The steps are **executable without improvisation** — concrete files,
   commands, flags, verification signals. "Do it carefully" fails this bar.

Skip (return empty \`skills: []\`) for:
- Single debugging incidents → \`problem_solution\` card instead.
- Generic advice with no concrete steps.
- Configuration snapshots → \`important_detail\` card instead.

Required shape per skill:
\`\`\`json
{
  "name": "3-8 words, action-oriented (\\"Publish SDK to npm\\")",
  "summary": "200-500 chars of second-person imperative — pasteable into an agent prompt. Include WHY in one clause so the agent knows when to deviate.",
  "methods": [{"step": 1, "description": "≥20 chars, names a file/command/verification — no vague verbs"}],
  "trigger_conditions": [{"pattern": "When publishing @awareness-sdk/*", "weight": 0.9}],
  "tags": ["npm", "publish", "release"],
  "reusability_score": 0.0,
  "durability_score": 0.0,
  "specificity_score": 0.0
}
\`\`\`

The daemon discards any skill with any of the three scores < 0.5 — score
honestly. ≥ 3 steps, ≥ 2 trigger patterns, 3-8 tags.
<!-- SHARED:skill-extraction END -->
Then call awareness_record(action="submit_insights", insights=<json>).`, warning: "Skipping = NO searchable knowledge cards; over-extracting pollutes memory — empty arrays are OK for noise turns" },
        { step: 5, action: "handle _skill_crystallization_hint (F-034)", when: "awareness_record response contains _skill_crystallization_hint", what: 'Review hint.similar_cards, synthesize into a skill, submit: awareness_record(insights={skills:[{name, summary, methods:[], trigger_conditions:[], tags:[], source_card_ids:[]}]})', warning: "Converts repeated patterns into reusable skills — skipping wastes the signal." },
      ],
      tips: {
        recall_vs_lookup: "awareness_recall = search by meaning. awareness_lookup = get by type (<50ms).",
        session_end: 'Call awareness_record(content="<final session summary>") with a final summary.',
        perception_signals: "awareness_record response may include 'perception' array (guards, patterns, resonance, staleness, contradictions). Treat guards as blocking warnings; patterns/resonance as context hints.",
        active_skills: "awareness_init returns active_skills[]: pre-loaded reusable procedures. When a task matches a skill's domain, apply its summary + methods instead of re-deriving the pattern.",
      },
    }),
  });

  // -----------------------------------------------------------------------
  // 1. awareness_init — initialize session and load cross-session project memory
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_init",
    name: "awareness_init",
    description:
      "Start here — call ONCE at session start to load persistent memory.\n\n" +
      "WHY: Without this, you have no memory of past sessions.\n" +
      "RETURNS: session_id, recent summaries, open tasks, knowledge cards.\n" +
      "If response contains _setup_action, you MUST follow it to write rules.\n" +
      "AFTER THIS: call awareness_recall to check for relevant past context.",
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          description: "Number of days to look back for context (default 7, max 90).",
          default: 7,
        },
        max_cards: {
          type: "integer",
          description: "Maximum knowledge cards to include (default 20).",
          default: 20,
        },
        max_tasks: {
          type: "integer",
          description: "Maximum tasks to include (default 20).",
          default: 20,
        },
        user_id: {
          type: "string",
          description: "Filter context by user ID (multi-user memory).",
        },
      },
    },
    execute: async (_toolCallId: string, input: Record<string, unknown>) => {
      const days = input.days !== undefined ? Number(input.days) : undefined;
      const maxCards = input.max_cards !== undefined ? Number(input.max_cards) : undefined;
      const maxTasks = input.max_tasks !== undefined ? Number(input.max_tasks) : undefined;
      return client.init(days, maxCards, maxTasks);
    },
  });

  // -----------------------------------------------------------------------
  // 1.5. awareness_get_agent_prompt — fetch sub-agent activation prompt
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_get_agent_prompt",
    name: "awareness_get_agent_prompt",
    description:
      "Fetch the full activation prompt for a specific agent role (sub-agent spawning).\n\n" +
      "Call BEFORE spawning a sub-agent to get its dedicated system prompt.\n" +
      "Use the returned activation_prompt as the sub-agent's system prompt so that\n" +
      "the main agent context stays clean and each sub-agent has an isolated, focused prompt.\n\n" +
      "Typical usage:\n" +
      "1. awareness_init returns agent_profiles with slim summaries.\n" +
      "2. When a task matches a role, call awareness_get_agent_prompt(agent_role='<role>').\n" +
      "3. Spawn a sub-agent with the returned activation_prompt as its system prompt.\n" +
      "4. The sub-agent passes agent_role='<role>' to all awareness_* calls for memory isolation.",
    parameters: {
      type: "object",
      properties: {
        agent_role: {
          type: "string",
          description: "The agent role to fetch (e.g. 'developer_agent', 'reviewer_agent').",
        },
      },
      required: ["agent_role"],
    },
    execute: async (_toolCallId: string, input: Record<string, unknown>) => {
      return client.getAgentPrompt(String(input.agent_role ?? ""));
    },
  });

  // -----------------------------------------------------------------------
  // 2. awareness_recall — cross-session recall with client-side query rewriting
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_recall",
    name: "awareness_recall",
    description:
      "Search persistent memory — pass ONE query string and the server does the rest.\n\n" +
      "Call BEFORE starting work to avoid re-solving solved problems.\n" +
      "Usage: awareness_recall(query=\"why did we choose pgvector?\")\n" +
      "Daemon auto-routes across memories + knowledge cards + workspace graph and picks\n" +
      "the right detail level based on token budget. Legacy multi-parameter surface still\n" +
      "works (logs [deprecated param used] warning) — semantic_query/keyword_query/scope/\n" +
      "recall_mode/detail/ids/multi_level/cluster_expand/include_installed will be removed\n" +
      "8 weeks after F-053 Phase 5.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language query — the ONLY parameter callers need. Example: " +
            "\"why did we pick pgvector over Pinecone?\"",
        },
        token_budget: {
          type: "integer",
          description:
            "Optional budget hint in tokens (default 5000). ≥50K → raw-heavy mix, " +
            "20K-50K → balanced, <20K → compressed card summaries.",
          default: 5000,
        },
        limit: {
          type: "integer",
          description: "Maximum results (default 6, max 30).",
          default: 6,
        },

        // --- [DEPRECATED] legacy multi-parameter surface (kept for compat) ---
        semantic_query: { type: "string", description: "[DEPRECATED] Use `query` instead." },
        keyword_query: { type: "string", description: "[DEPRECATED] Use `query` instead." },
        scope: {
          type: "string",
          enum: ["all", "timeline", "knowledge", "insights"],
          description: "[DEPRECATED] Daemon auto-scopes.",
        },
        vector_weight: { type: "number", description: "[DEPRECATED] Server picks weights." },
        bm25_weight: { type: "number", description: "[DEPRECATED] Server picks weights." },
        recall_mode: {
          type: "string",
          enum: ["precise", "session", "structured", "hybrid", "auto"],
          description: "[DEPRECATED] Daemon auto-routes.",
        },
        multi_level: { type: "boolean", description: "[DEPRECATED] Always on." },
        cluster_expand: { type: "boolean", description: "[DEPRECATED] Always on." },
        confidence_threshold: { type: "number", description: "[DEPRECATED]" },
        include_installed: { type: "boolean", description: "[DEPRECATED] Always on." },
        user_id: { type: "string", description: "Filter results by user ID (multi-user memory)." },
        agent_role: { type: "string", description: "Override agent role (defaults to plugin config)." },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description: "[DEPRECATED] Budget-driven.",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "[DEPRECATED] Progressive disclosure — pair with detail=full.",
        },
      },
      required: ["query"],
    },
    execute: async (_toolCallId: string, input: Record<string, unknown>) => {
      const legacyFullTextWeight = input[LEGACY_FULL_TEXT_WEIGHT_KEY];
      // F-053 Phase 2: resolve effective query from `query` (preferred) or legacy aliases.
      const effectiveQuery = String(
        input.query ?? input.semantic_query ?? input.keyword_query ?? "",
      );
      return client.search({
        semanticQuery: effectiveQuery,
        keywordQuery: input.keyword_query !== undefined ? String(input.keyword_query) : undefined,
        scope: (input.scope as "all" | "timeline" | "knowledge" | "insights") ?? "all",
        limit: input.limit !== undefined ? Number(input.limit) : undefined,
        vectorWeight: input.vector_weight !== undefined ? Number(input.vector_weight) : undefined,
        bm25Weight:
          input.bm25_weight !== undefined
            ? Number(input.bm25_weight)
            : legacyFullTextWeight !== undefined
              ? Number(legacyFullTextWeight)
              : undefined,
        recallMode: (input.recall_mode as "precise" | "session" | "structured" | "hybrid" | "auto") ?? "auto",
        multiLevel: input.multi_level !== undefined ? Boolean(input.multi_level) : undefined,
        clusterExpand: input.cluster_expand !== undefined ? Boolean(input.cluster_expand) : undefined,
        confidenceThreshold: input.confidence_threshold !== undefined ? Number(input.confidence_threshold) : undefined,
        includeInstalled: input.include_installed !== undefined ? Boolean(input.include_installed) : true,
        userId: input.user_id !== undefined ? String(input.user_id) : undefined,
        agentRole: input.agent_role !== undefined ? String(input.agent_role) : undefined,
        detail: (input.detail as "summary" | "full" | undefined),
        ids: Array.isArray(input.ids) ? (input.ids as unknown[]).map(String) : undefined,
      });
    },
  });

  // -----------------------------------------------------------------------
  // 3. awareness_lookup — structured data retrieval (no vector search)
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_lookup",
    name: "awareness_lookup",
    description:
      "Fast DB lookup — use instead of awareness_recall when you know WHAT you want.\n" +
      "awareness_recall = search by meaning (semantic). awareness_lookup = get by type (<50ms).\n" +
      "Examples: type=\"tasks\" for open tasks, type=\"knowledge\" for cards, type=\"risks\" for risks.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["context", "tasks", "knowledge", "risks", "session_history", "timeline", "handoff", "rules", "graph", "agents"],
          description: "Type of data to retrieve.",
        },
        query: { type: "string", description: "Keyword filter for knowledge cards (not vector search)." },
        category: { type: "string", description: "Category filter for knowledge cards." },
        status: { type: "string", description: "Status filter (e.g., pending, in_progress, completed)." },
        priority: { type: "string", description: "Priority filter for tasks (high, medium, low)." },
        include_completed: { type: "boolean", description: "Include completed tasks (default false).", default: false },
        level: { type: "string", description: "Risk level filter (high, medium, low)." },
        session_id: { type: "string", description: "Session ID for session_history type." },
        limit: { type: "integer", description: "Maximum items to return (default 50).", default: 50 },
        offset: { type: "integer", description: "Pagination offset (default 0).", default: 0 },
        user_id: { type: "string", description: "Filter by user ID (multi-user memory)." },
        format: { type: "string", description: "Output format for rules type (json, cursorrules, claude-md, markdown)." },
        entity_id: { type: "string", description: "Entity ID for graph neighbor lookup." },
        entity_type: { type: "string", description: "Entity type filter for graph lookup." },
        search: { type: "string", description: "Name search for graph entities." },
        max_hops: { type: "integer", description: "Traversal depth for graph neighbor lookup (1-4)." },
      },
      required: ["type"],
    },
    execute: async (_toolCallId: string, input: Record<string, unknown>) => {
      return client.getData(
        String(input.type ?? "context"),
        input as Record<string, unknown>,
      );
    },
  });

  // -----------------------------------------------------------------------
  // 4. awareness_record — unified write (remember, batch, ingest, update, submit)
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_record",
    name: "awareness_record",
    description:
      "Save memory — pass ONE content string and the server does the rest.\n\n" +
      "Call AFTER every meaningful action. If you don't record it, it's lost.\n" +
      "PRIMARY: awareness_record(content=<detailed description with reasoning, code snippets, files>)\n" +
      "WITH INSIGHTS: awareness_record(content=\"summary\", insights={...})\n\n" +
      "CRITICAL: When response contains _extraction_instruction, you MUST follow it\n" +
      "to extract insights, then call awareness_record(content=\"summary\", insights=<json>).\n" +
      "Skipping = raw events stored but NO searchable knowledge cards created.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description:
            "Memory content (markdown, detailed natural language). The ONLY parameter " +
            "callers need — server defaults action=write and triggers async extraction. " +
            "Example: awareness_record(content=\"Today I decided to...\").",
        },
        insights: {
          type: "object",
          description:
            "Optional pre-extracted structured insights. Include knowledge_cards, " +
            "action_items, risks, completed_tasks. When provided, skips the " +
            "_extraction_instruction round-trip.",
        },

        // --- Advanced actions (explicit — server will not infer these) ---
        action: {
          type: "string",
          enum: ["write", "update_task"],
          description:
            "[DEPRECATED] Defaults to \"write\" when content is provided. " +
            "update_task still requires explicit action=update_task + task_id + status.",
        },
        text: { type: "string", description: "[DEPRECATED] Legacy alias for content." },
        task_id: { type: "string", description: "Task ID (only for action=update_task)." },
        status: { type: "string", description: "New status (only for action=update_task)." },
        metadata: { type: "object", description: "Optional metadata to attach to events." },
        user_id: { type: "string", description: "User ID for multi-user memory attribution." },
      },
      required: ["content"],
    },
    execute: async (_toolCallId: string, input: Record<string, unknown>) => {
      const result = await client.write(
        String(input.action ?? "remember"),
        input as Record<string, unknown>,
      );
      // Cache perception signals for next auto-recall injection
      const perception = (result as Record<string, unknown>)?.perception;
      if (Array.isArray(perception) && perception.length > 0) {
        cachePerception(perception as PerceptionSignal[]);
      }
      // Sync to OpenClaw Markdown files (daily log + MEMORY.md for knowledge cards)
      const content = String(input.content ?? input.text ?? "");
      if (content.length > 10) {
        syncRecordToOpenClaw(
          content,
          input.insights as Record<string, unknown> | undefined,
          "awareness-record",
        );
      }
      return result;
    },
  });

  // -----------------------------------------------------------------------
  // 5. memory_search — OpenClaw standard memory tool (replaces memory-core)
  //    This makes Awareness compatible with plugins.slots.memory replacement.
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "memory_search",
    name: "memory_search",
    description:
      "Search across your persistent memory using semantic + keyword hybrid retrieval.\n" +
      "Powered by Awareness Memory — structured knowledge cards, cross-session recall.\n" +
      "Returns relevant snippets with file path, score, and context.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query." },
        limit: { type: "integer", description: "Maximum number of results (default 10).", default: 10 },
      },
      required: ["query"],
    },
    execute: async (_toolCallId: string, input: Record<string, unknown>) => {
      const query = String(input.query || "");
      const limit = Number(input.limit) || 10;
      const results = await client.search({
        semanticQuery: query,
        limit,
        detail: "summary",
      });

      // Format results to match memory-core's expected output
      const items: Array<{ path: string; score: number; snippet: string; startLine: number; endLine: number }> = [];
      const rawResults = results?.results ?? [];
      for (const r of rawResults) {
        items.push({
          path: (r as any).filepath || r.source || "awareness-memory",
          score: r.score || 0,
          snippet: String(r.content || r.summary || "").slice(0, 700),
          startLine: 1,
          endLine: 1,
        });
      }

      if (items.length === 0) {
        return { result: "No matching memories found." };
      }

      return items;
    },
  });

  // -----------------------------------------------------------------------
  // 6. memory_get — OpenClaw standard memory get (replaces memory-core)
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "memory_get",
    name: "memory_get",
    description:
      "Retrieve the full content of a specific memory item by ID.\n" +
      "Use after memory_search to get complete details of a relevant result.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory item ID to retrieve." },
      },
      required: ["id"],
    },
    execute: async (_toolCallId: string, input: Record<string, unknown>) => {
      const id = String(input.id || "");
      if (!id) return { error: "ID is required" };

      const results = await client.search({
        semanticQuery: id,
        limit: 1,
        detail: "full",
        ids: [id],
      });

      const content = results?.results?.[0]?.content;
      if (!content) return { result: "Memory item not found." };
      return { content };
    },
  });

  // -----------------------------------------------------------------------
  // 7. awareness_apply_skill — Execute a learned skill
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_apply_skill",
    name: "awareness_apply_skill",
    description:
      "Apply a learned skill — returns a structured step-by-step execution plan.\n" +
      "Call this when a task matches an active skill from the <skills> section.\n" +
      "The skill will be marked as used automatically (resets decay timer).\n" +
      "After completing the task, call awareness_mark_skill_used with outcome feedback.",
    parameters: {
      type: "object",
      properties: {
        skill_id: {
          type: "string",
          description: "ID of the skill to apply (from active_skills in awareness_init).",
        },
        context: {
          type: "string",
          description: "Current task context — the skill methods will be adapted to this context.",
        },
      },
      required: ["skill_id"],
    },
    execute: async (_toolCallId: string, input: Record<string, unknown>) => {
      const skillId = String(input.skill_id || "");
      const context = String(input.context || "");
      if (!skillId) return { error: "skill_id is required" };

      const result = await client.applySkill(skillId, context);
      return result;
    },
  });

  // -----------------------------------------------------------------------
  // 8. awareness_mark_skill_used — Report skill outcome feedback
  // -----------------------------------------------------------------------
  api.registerTool({
    id: "awareness_mark_skill_used",
    name: "awareness_mark_skill_used",
    description:
      "Report skill usage outcome after applying a skill.\n" +
      "Closes the feedback loop: 'success' (default) resets decay fully,\n" +
      "'partial' gives reduced boost, 'failed' decreases confidence.\n" +
      "3+ consecutive failures auto-flag the skill for review.",
    parameters: {
      type: "object",
      properties: {
        skill_id: {
          type: "string",
          description: "ID of the skill to mark as used.",
        },
        outcome: {
          type: "string",
          enum: ["success", "partial", "failed"],
          description: "Outcome of applying the skill. Default: 'success'.",
        },
      },
      required: ["skill_id"],
    },
    execute: async (_toolCallId: string, input: Record<string, unknown>) => {
      const skillId = String(input.skill_id || "");
      if (!skillId) return { error: "skill_id is required" };
      const outcome = (input.outcome as "success" | "partial" | "failed") || "success";
      return client.markSkillUsed(skillId, outcome);
    },
  });
}
