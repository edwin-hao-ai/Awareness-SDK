# Changelog

## [0.6.16] - 2026-04-19

### Added — F-059/F-060 passthrough

- F-059 skill types (`pitfalls: string[]`, `verification: string[]`,
  `growth_stage: seedling|budding|evergreen`) now flow from daemon
  response into plugin consumers unchanged (types added in 0.6.15 SDK
  updates; this bump tracks the daemon protocol).
- F-060 `hyde_hint` recall parameter documented in tool descriptions
  so OpenClaw agents generate client-side HyDE spontaneously.

## [0.6.15] - 2026-04-19

### Added — F-056 SSOT prompt wire-up (recall-friendliness R6-R8)
- `src/tools.ts` step-4 extraction instruction now carries the full
  shared-prompt SSOT from `sdks/_shared/prompts/`:
  - When-to-extract / when-not-to-extract envelope rules
  - Per-card 3-score rubric (novelty / durability / specificity)
  - Daemon quality gate R1-R5 (structural) + R6-R8 (recall-friendliness)
  - Skill extraction into `insights.skills[]`
- **Biggest user-visible change**: the OpenClaw agent now gets the same
  extraction guidance as Claude Code — crucially the skill-extraction
  block, which was previously backend-only. OpenClaw sessions now
  populate `insights.skills[]` instead of losing skills entirely.
- Token cost: step-4 grows from ~1.8 KB → ~3.2 KB. The `what:` array
  is composed via template literal so the sync script can safely
  inject multi-line Markdown without breaking TS syntax.

### Changed — title quality guidance
- Tools.ts now includes R6 (grep-friendly title), R7 (topic-specific
  tags), R8 (multilingual keyword diversity) so OpenClaw-extracted cards
  are actually findable later. Pre-F-056 cards often had titles like
  "Decision made" / "Bug fixed" that score ~30 % precision@3 in
  retrieval benchmarks.

### Compatibility
- Still requires `@awareness-sdk/local@0.9.0+` for the full daemon
  quality gate (R1-R5 enforcement + cards_skipped response).

## [0.6.14] - 2026-04-18

### Fixed — F-055 bug B: OpenClaw runtime metadata envelope pollution
- `agent_end` auto-capture now strips runtime metadata envelopes before
  building the `Request: ...` / `Result: ...` turn brief. Previously the
  plugin wrote content like `Request: Sender (untrusted metadata): ...`
  and `Request: [Operational context metadata — do not answer this
  section directly] ...` straight into memory titles, polluting both the
  memory list and vector embeddings.
- If the user message collapses to envelope-only noise after stripping,
  `awareness_record` is no longer called (the turn is dropped with an
  `info`-level log).

### Added — `stripMetadataEnvelope(input)` pure helper
- New `src/envelope-strip.ts` (ESM-safe, zero deps) with 26 vitest cases
  covering single/double/triple-nested envelopes, `Request:` / `Result:` /
  `Send:` line prefixes, CJK content, malformed / null / oversized input,
  and non-over-strip guards (e.g. `"Requester: Alice"` stays unchanged).
- Wired into both `hooks.ts` (reference plugin) and `memory-awareness.ts`
  (OpenClaw native adapter) agent_end hooks.

### Test coverage
- Plugin suite: 174 → **200** tests passing (8 files). No regressions.
- L3 defense-in-depth: new `sdks/local/test/f055-defense-in-depth.test.mjs`
  (6 cases) verifies the daemon `classifyNoiseEvent` already rejects
  envelope-only payloads if a misbehaving client bypasses the plugin strip.

### Scope note
- Purely local-end fix. Backend / cloud extraction prompts are unchanged
  per F-055 scope. Complements F-055 bug A (persona gate) and bug C
  (aggregator ranking penalty) which ship separately in
  `@awareness-sdk/local` 0.9.x.

## [0.6.13] - 2026-04-18

### Changed — local daemon recall uses F-053 single-parameter surface
- `AwarenessClient.localSearch()` (local mode only) now sends
  `{query, limit, token_budget?, agent_role?}` to the daemon via
  `awareness_recall` MCP. Legacy fields (`semantic_query` / `keyword_query` /
  `detail` / `scope` / `recall_mode` / `source_exclude` / `ids`) are
  forwarded only when the caller explicitly passed the corresponding
  `SearchOptions` field AND did not pass a `query` override.
- **Why**: before this release, OpenClaw's local MCP path sent the pre-F-053
  multi-parameter shape even when callers passed a plain natural-language
  query, bypassing Phase 3 query-type auto-routing + recency channel +
  budget-tier bucket shaping. Cloud (`/memories/:id/retrieve` REST) path is
  unchanged because the cloud backend still uses the old multi-field body
  schema — it has its own migration ticket.

### Added — SearchOptions.query + SearchOptions.tokenBudget
- `query?: string` is the preferred single-parameter field. Pass one natural
  question; the daemon picks scope, recall mode, detail, and bucket shape.
- `semanticQuery` is now optional and marked `@deprecated` in TSDoc. Existing
  callers keep working without changes (legacy branch auto-hoists
  `semanticQuery` → `query`).
- `tokenBudget?: number` hints at the raw-vs-card mix tier (local daemon only).

### Added — L2 tests
- 5 new assertions in `client.local-recall.test.ts` lock the F-053 daemon-args
  shape: `{query, limit}` default, `token_budget` forwarding, `semanticQuery`
  fallback, `keyword_query` deprecation path, and explicit-`query`-wins
  regression guards. Full suite now 174/174 passing (up from 169).

### Compatibility
- Requires `@awareness-sdk/local@0.8.0+` for full Phase 3 quality (recency
  channel + budget-tier shaping). Older daemons still work via the legacy
  `keyword_query`/`scope`/etc forwarding path — existing callers unchanged.

## [0.6.12] - 2026-04-17

### Changed
- **Salience-aware extraction in workflow step 4** — mirrors the philosophy
  shipped in `@awareness-sdk/local@0.7.3`. The `_extraction_instruction` hint
  we inject into the agent now says "identify the distilled essence worth
  recalling in 6 months", not "always create cards for …". Returning
  `knowledge_cards: []` is a first-class answer. Each card must carry three
  0.0-1.0 self-assessments: `novelty_score`, `durability_score`,
  `specificity_score`. The daemon drops cards below 0.4 on novelty or 0.4
  on durability. No migration needed — reinstall via
  `openclaw plugins install @awareness-sdk/openclaw-memory@latest` and the
  new guidance kicks in on the next session.

## [0.6.11](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.10...sdks/openclaw-v0.6.11) (2026-04-17)


### Bug Fixes

* **plugin:** add openclaw.extensions field to package.json for proper plugin loading ([95c181d](https://github.com/edwinhao/Awareness/commit/95c181d0889a03b042ef3373660b7a03e4740781))

## [0.6.10](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.9...sdks/openclaw-v0.6.10) (2026-04-16)

### Fixed
- **OpenClaw tool execution**: Fixed execute function signatures to accept (toolCallId, input) parameters as expected by the OpenClaw protocol, resolving the issue where input.semantic_query was undefined due to incorrect parameter handling.

## [0.6.9](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.8...sdks/openclaw-v0.6.9) (2026-04-16)

### Fixed
- **Input schema validation**: Fixed registerTool API to use `parameters` instead of `inputSchema` to prevent "schema must be object or boolean" validation errors when calling tools. The `inputSchema` field has been deprecated in favor of the standard `parameters` field for defining tool input schemas.

## [0.6.7](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.6...sdks/openclaw-v0.6.7) (2026-04-16)

### Added
- **`awareness_mark_skill_used` tool**: New tool #8 allowing LLMs to report skill execution outcomes (success/partial/failed). Outcomes adjust decay score, confidence, and consecutive failure tracking.
- **`client.markSkillUsed()` method**: Supports both local (MCP JSON-RPC) and cloud (REST) modes with outcome parameter.

### Changed
- **`awareness_apply_skill` description updated**: Now mentions outcome feedback via `awareness_mark_skill_used`.
- **Wiki-style knowledge cards**: Extraction prompts produce rich 200-800 char Markdown entries.

## [0.6.6](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.5...sdks/openclaw-v0.6.6) (2026-04-15)

### Changed
- **Salience-aware extraction guidance**: `awareness_record` step 4 now includes HIGH_SALIENCE signals — LLM prioritizes decisions, bug fixes, approach reversals, and never/always rules with `novelty_score` and `salience_reason` fields. Improves knowledge card quality and reduces noise.

## [0.6.5](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.4...sdks/openclaw-v0.6.5) (2026-04-15)

### Changed
- **Ship-gate quality enforcement**: `prepublishOnly` now runs the full 5-layer ship-gate (`build → L1 static → L2 unit → L3 chaos → L4 e2e`). Future releases require all gates green before any npm publish.
- **LongMemEval benchmark README**: Updated with ASCII art visualizations showing R@5=95.6% vs 61.2% baseline.

## [0.6.4](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.3...sdks/openclaw-v0.6.4) (2026-04-13)

### Added
- **`awareness_apply_skill` tool**: LLM can now actively call learned skills via `awareness_apply_skill(skill_id, context)` instead of passively reading injected text. Returns structured execution plan with methods and context-adapted guidance. Automatically marks skill as used.
- **`client.applySkill()` method**: New client method for both local (MCP) and cloud (REST) modes.

## [0.6.3](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.2...sdks/openclaw-v0.6.3) (2026-04-12)

### Added (F-035 — headless device auth)
- New `src/headless-auth.ts` module with `isHeadlessEnv()` / `openBrowserSilently()` / `renderDeviceCodeBox()` — detects SSH / Codespaces / Gitpod / no-TTY / missing-DISPLAY hosts.
- `awareness_setup(action='start_auth')` now returns a prominent ASCII-boxed `message` field that the LLM renders verbatim to the user, plus a new `is_headless` boolean so agents can tailor follow-up prompts.
- Exported `registerSetupMode()` so downstream testing and integration can exercise the setup path directly.
- `poll-auth.ts` default expires_in: 600s → 900s (aligned with backend TTL).
- Auto-start hook's `prependSystemContext` now produces a headless-aware setup line when `AWARENESS_HEADLESS=1` or the host is detected as remote.

### Why
- Cloud-hosted OpenClaw users (飞书/Telegram bots on VPS, Docker containers, Codespaces) previously had no way to complete device auth. The plugin would silently fail to open a browser and the LLM had no structured way to tell the user "go click this on your phone". F-035 brings the entire UX into structured plugin output so any LLM can present it correctly.

## [0.6.2](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.1...sdks/openclaw-v0.6.2) (2026-04-11)

### Added
- **Workflow step 5 — F-034 skill crystallization**: `__awareness_workflow__` now returns step 5 instructing agents to handle `_skill_crystallization_hint` responses from `awareness_record`. When the local daemon or cloud detects 3+ similar workflow/decision/problem_solution cards, agents should synthesize them into a reusable skill and submit via `awareness_record(insights={skills:[{name, summary, methods, trigger_conditions, tags, source_card_ids}]})`.
- **New workflow tips**: `perception_signals` and `active_skills` tips now documented in the workflow tool output — agents know to treat guards as blocking, apply active skills instead of re-deriving patterns.

### Spec sync
- `awareness-spec.json` (bundled via CI sync from `backend/awareness-spec.json`) now includes the deprecated `skill` category note (F-032 uses the dedicated `skills` table) and step 5 crystallization guidance.

## [0.6.1](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.6.0...sdks/openclaw-v0.6.1) (2026-04-05)

### Fixed
- **Title metadata leakage**: `parseRecallSummaryBlocks` regex now strips trailing `(85%, 3d ago, ~120tok)` from title capture, preventing metadata from leaking into display text.

## [0.6.0](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.18...sdks/openclaw-v0.6.0) (2026-04-04)

### Added
- **memory_search tool**: OpenClaw-standard `memory_search` tool for `plugins.slots.memory` replacement. When Awareness is set as the memory slot, agents can use `memory_search` just like with memory-core, but backed by hybrid vector+BM25 retrieval with structured knowledge cards.
- **memory_get tool**: OpenClaw-standard `memory_get` tool for retrieving full memory content by ID.
- Both tools are registered alongside the existing 6 awareness tools (total 8 tools).

### Changed
- Plugin now fully supports `plugins.slots.memory: "openclaw-memory"` to replace OpenClaw's built-in memory-core.
- memory-core and memory-lancedb are automatically disabled when Awareness occupies the memory slot.

## [0.5.18](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.17...sdks/openclaw-v0.5.18) (2026-04-02)

### Changed
- **Context-first local recall**: local daemon auto-recall now forwards the current prompt into `awareness_init(query)` so rendered context stays aligned with the user's current focus.
- **Progressive disclosure parsing**: local MCP recall summary blocks are parsed into structured results before expansion, matching the daemon's summary-first recall contract.

### Fixed
- **Local summary recall handling**: OpenClaw local-mode client now understands the daemon's two-block summary response shape instead of treating it as opaque text.
- **Hook context continuity**: recall hooks now preserve current-focus metadata across local fallback paths, keeping prompt injection consistent with other clients.

## [0.5.17](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.16...sdks/openclaw-v0.5.17) (2026-04-01)

### Fixed
- **Hook migration with backward compatibility**: Migrated `before_agent_start` → `before_prompt_build` for OpenClaw v2026.3.22+. Both hooks are registered simultaneously with prompt-based dedup guard, ensuring the plugin works on both old and new OpenClaw versions.
- **Hash dedup collision fix**: Replaced simple JSHash with `content.slice(0,120)|length` composite key — near-zero collision probability for short messages.
- **Test copy-paste bug**: `hookLegacy` assertion was checking `before_prompt_build` instead of `before_agent_start`.

### Changed
- **Recall threshold lowered**: Score filter reduced from 0.5 → 0.35 to improve recall rate, especially for CJK content with cross-language semantic matching.

## [0.5.16](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.15...sdks/openclaw-v0.5.16) (2026-03-31)

### Fixed
- **26-issue audit**: Data safety, dedup, i18n, and test fixes across the SDK.

## [0.5.15](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.14...sdks/openclaw-v0.5.15) (2026-03-31)

### Fixed
- **Local-mode plugin init**: Source isolation and sourceExclude filtering improvements.

## [0.5.14](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.13...sdks/openclaw-v0.5.14) (2026-03-27)

### Fixed
- **Critical: async register bug** — OpenClaw host ignores async `register()` return values, causing plugin initialization to be silently skipped. Refactored to synchronous `register()` with background daemon health-check via `ensureLocalDaemon()`. Tools and hooks now register immediately (local-first optimistic mode), daemon availability verified asynchronously.
- **Local-first default** — without cloud credentials, plugin now registers full tools/hooks for local daemon mode instead of entering setup-only mode. Setup mode only activates as fallback if daemon check fails in background.

### Changed
- Updated tests to reflect new sync register + local-first behavior (139 tests passing)

## [0.5.13](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.12...sdks/openclaw-v0.5.13) (2026-03-27)

### Fixed
- **Plugin version sync**: `openclaw.plugin.json` version was stuck at `0.1.10` — OpenClaw host displayed wrong version to users. Now synced to match `package.json`

## [0.5.12](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.11...sdks/openclaw-v0.5.12) (2026-03-27)

### Added
- **One-time dashboard welcome**: on first local daemon connection, injects `<dashboard>` element into `<awareness-memory>` block telling user the dashboard URL (http://localhost:PORT). Uses `~/.awareness/dashboard-welcomed` marker to show only once.
- Made `AwarenessClient.isLocal` public (was private) so hooks can check mode

## [0.5.11](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.10...sdks/openclaw-v0.5.11) (2026-03-27)

### Fixed
- **Device auth URL injection format**: Changed `before_agent_start` hook from `prependSystemContext` to `<awareness-memory>` XML block with `<setup-required>` element — LLMs reliably display this format when user asks about memory
- **Tested**: Verified with qwen-turbo: "我想启用记忆功能" → agent immediately returns device auth URL with `?code=` param

## [0.5.10](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.9...sdks/openclaw-v0.5.10) (2026-03-27)

### Changed
- **Auto device auth in `before_agent_start` hook**: when no credentials are configured, the hook now automatically calls `/auth/device/init` and injects the login URL directly into the agent's system context — user just starts a conversation and the agent immediately shows them the link. No tool call required.
- Fixed hook registration: changed from `api.registerHook()` to `api.on()` (correct OpenClaw API)

## [0.5.9](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.8...sdks/openclaw-v0.5.9) (2026-03-27)

### Fixed
- **Device auth `memoryId` parsing**: `/memories` API returns a plain array, not `{ memories: [...] }` — poll-auth.js now handles both formats correctly
- **Device auth URL**: `auth_url` now includes `?code=` query param so `cli-auth` page auto-fills the code (avoids "Missing Code" error)

## [0.5.8](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.7...sdks/openclaw-v0.5.8) (2026-03-27)

### Added
- **Device Auth Flow** for mobile/Android users: call `awareness_setup(action='start_auth')` to get a URL+code for browser-based login — no manual config editing required
  - Phase 1 (`start_auth`): calls `/auth/device/init`, spawns `poll-auth.js` as detached background process, returns `{auth_url, user_code}`
  - Phase 2 (`check_auth`): reads `~/.awareness/device-auth-result.json`, returns success if approved
  - `poll-auth.js`: background poller that writes `apiKey + memoryId` to `~/.openclaw/openclaw.json` when device is approved
- **Termux/Android detection**: skips the 8-second daemon auto-start loop on Android (detects via `TERMUX_VERSION` env or `PREFIX` path), removing an 8s startup penalty for mobile users
- Updated `prependSystemContext` hint to guide users toward `start_auth` action instead of command-line alternatives

## [0.5.7](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.6...sdks/openclaw-v0.5.7) (2026-03-27)

### Added
- **Bidirectional sync with OpenClaw native Markdown memory**:
  - Write-back: after every `awareness_record`, mirrors content to `memory/YYYY-MM-DD.md` (daily log) and knowledge cards to `MEMORY.md`
  - Import: on first install, automatically imports existing MEMORY.md + daily logs + session JSONL history into Awareness (idempotent via marker file)
  - Flat insights format support: handles LLM outputs with `{category, decision}` (not just `{knowledge_cards: [...]}`)

### Fixed
- Increased truncation limits to preserve content completeness:
  - MEMORY.md write-back: 300 → 1200 chars per card summary
  - Daily log write-back: 500 → 3000 chars per entry
  - Import daily blocks: 600 → 3000 chars
  - Import session messages: 300 → 800 chars per message

## [0.5.6](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.5...sdks/openclaw-v0.5.6) (2026-03-27)

### Added
- **Perception (Eywa Whisper) support**: record-time push signals now cached and injected into next auto-recall
- `cachePerception()` in hooks.ts and tools.ts writes signals to `~/.awareness/perception-cache.json`
- `consumePerception()` in auto-recall hook reads + clears signals (30-min TTL, max 5 per injection)
- `<perception>` XML block with `<action-required>` directive injected into LLM system context
- Perception signals from both auto-capture and manual awareness_record tool calls are cached

## [0.5.5](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.5.4...sdks/openclaw-v0.5.5) (2026-03-27)

### Fixed
- **Local daemon mode**: client now uses MCP JSON-RPC (`/mcp`) instead of cloud REST paths that don't exist on local daemon
- Auto-recall hook now works in local mode (was getting 404 on `/memories/{id}/context`)
- Auto-capture hook now works in local mode (was getting 404 on `/mcp/events`)
- All awareness_* tool calls (init, recall, record, lookup) now work via MCP in local mode

### Added
- `isLocal` detection in AwarenessClient (empty apiKey + localhost URL)
- `mcpCall()` / `mcpCallRaw()` helpers for MCP JSON-RPC protocol
- Local recall response parsing: converts MCP two-block format to RecallResult

## [0.1.3](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.1.2...sdks/openclaw-v0.1.3) (2026-03-14)

### Fixed
- Corrected API key prefix in example config (`ak-` → `aw_`)
- Corrected local development install path in README (`./sdks/openclaw` → `./openclaw`)

## [0.1.2](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.1.1...sdks/openclaw-v0.1.2) (2026-03-12)

### Changed
- Renamed the public hybrid search option to `full-text` wording while keeping runtime compatibility for older callers.
- Updated the tool schema to expose `full_text_weight` instead of the internal algorithm label.

### Fixed
- Ensured `full_text_weight` is forwarded in the retrieve payload for OpenClaw callers.

## [0.1.1](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.1.0...sdks/openclaw-v0.1.1) (2026-03-12)

### Fixed
- Sent `confidence_threshold` and `include_installed` as top-level retrieve payload fields so the plugin matches the backend API contract.
- Updated plugin tests to verify the corrected request shape.

## [0.1.0](https://github.com/edwinhao/Awareness/compare/sdks/openclaw-v0.0.1...sdks/openclaw-v0.1.0) (2026-03-09)

### Added
- Initial OpenClaw plugin release.
- Awareness-backed memory recall, lookup, and recording tools.
