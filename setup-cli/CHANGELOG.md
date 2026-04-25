# Changelog

## [0.4.12] - 2026-04-25

### Fixed — fresh-install daemon-start no longer fails on slow networks

`tryStartDaemon` previously gave up after 10 seconds. On a brand-new machine
the daemon takes 30–90s to start because `npx @awareness-sdk/local start`
fetches the package and compiles `better-sqlite3` natively. We now wait up
to 90s and, if it still hasn't responded, **print a warning and continue
with MCP config sync** instead of exiting 1. The user's IDE will pick up
the daemon once it finishes downloading.

**Impact**: zero risk for existing users — they had the daemon already
running so this branch never affects them.

## [0.4.11] - 2026-04-25

### Fixed — no-IDE fresh install no longer exits 1

Setup CLI used to hard-fail with `Could not auto-detect IDE. Use --ide <name>`
exit 1 when run on a host with no supported IDE installed (CI agents, headless
SSH, fresh Docker containers). It now prints an informational message and
continues with daemon-only setup, exit 0. Users can wire MCP later via
`npx @awareness-sdk/setup --ide <name>`.

**Impact**: zero risk for existing users — they always had IDEs detected and
this branch never ran for them. Only edge cases improve.

## [0.4.10] - 2026-04-19

### Changed — F-059/F-060 spec re-sync
- Bundled `awareness-spec.json` updated with F-059 skill shape
  (pitfalls, verification, mandatory content bars) and F-060 HyDE
  field description in `init_guides.search_guide`.

## [0.4.9] - 2026-04-19

### Changed — F-056 prompt SSOT re-sync (bundled `awareness-spec.json`)
- Bundled `awareness-spec.json` refreshed to match `backend/awareness-spec.json`
  as of 2026-04-19. `init_guides.write_guide` now carries the F-055 / F-056
  extraction contract in full:
  - Daemon quality gate R1-R5 (structural) — length / envelope / placeholder.
  - Recall-friendliness R6-R8 (soft) — grep-friendly title / topic-specific tags
    / multilingual keyword diversity.
  - Explicit skill extraction under `insights.skills[]` (previously only
    hinted as "deprecated `skill` category").
- New-user IDEs configured by `awareness-setup` now receive the same extraction
  guidance as Claude Code and OpenClaw — no drift between channels.

### Compatibility
- Requires `@awareness-sdk/local@0.9.0+` for daemon-side enforcement of R1-R5.

## [0.4.8] - 2026-04-18

### Changed — F-053 single-parameter prompt re-sync (bundled `awareness-spec.json`)
- **What slipped through in 0.4.7**: when F-053 shipped the single-parameter
  MCP surface (`awareness_recall({query: "..."})` / `awareness_record({content: "..."})`),
  the prompt text bundled with setup-cli still described the pre-F-053 two-phase
  progressive-disclosure pattern (`awareness_recall(semantic_query=..., keyword_query=..., detail='summary')`
  then `detail='full' + ids=[...]`). Users running `npx @awareness-sdk/setup` got
  an `awareness-spec.json` that taught their IDE agent the **old** API, causing
  deprecation-warning spam and worse recall quality (no Phase 3 query-type
  routing, no recency channel, no budget-tier shaping for the agent's calls).
- **Fix (this release)**: `sdks/setup-cli/awareness-spec.json` is now a byte-for-byte
  copy of `backend/awareness-spec.json` (the SSOT per `CLAUDE.md`). Three sections
  changed materially:
  - `awareness_recall.long_desc` → "Pass a single natural-language query..."
  - `awareness_record.long_desc` → "Pass a single content string..."
  - `workflow_reference.action` for recall → "single-parameter search" (was "two-phase progressive disclosure")
- **No CLI behaviour change** — same `setup` / `test-recall` / `reset` commands,
  same exit codes, same side effects. Only the bundled spec text is newer.
- Aligned with `@awareness-sdk/local@0.8.0` and `awareness-memory@0.3.8` published
  the same day.

## [0.4.7] - 2026-04-17

### Changed
- **Salience-aware extraction philosophy — synced with backend**. The bundled
  `awareness-spec.json` (which `setup` writes into the user's IDE config) now
  carries the v0.7.3 `init_guides.write_guide` from the backend: framing
  flipped from "always create cards for …" to "identify the distilled essence
  worth recalling in 6 months", empty `knowledge_cards: []` is a first-class
  answer, each card must carry three 0.0-1.0 scores
  (`novelty_score`, `durability_score`, `specificity_score`). No CLI surface
  change — just a richer guide string that downstream LLMs read verbatim.

## [0.4.6] - 2026-04-15

### Changed
- **Salience-aware extraction guidance**: bundled `awareness-spec.json` updated with HIGH_SALIENCE signals and `novelty_score`/`salience_reason` fields. IDE rules injected by `setup` CLI now guide LLMs to prioritize decisions, bug fixes, and approach reversals with structured salience metadata.

## [0.4.5] - 2026-04-15

### Changed
- **Ship-gate quality enforcement**: `prepublishOnly` now runs the 5-layer ship-gate (`L1 syntax → L2 unit → L3 chaos echo`). Future releases require all gates green before any npm publish.

## [0.4.4] - 2026-04-12

### Added (F-035 — headless device auth)
- New `src/headless-auth.mjs` helper: zero-dep `isHeadlessEnv()` auto-detects SSH/Codespaces/Gitpod/no-TTY/missing-DISPLAY environments, renders a boxed user-code display, and gracefully skips the `open`-browser attempt on remote hosts.
- `runAuthFlow()` now shows a prominent ASCII box with the `user_code`, verification URL, and TTL — useful even on local machines when the browser is on a different screen.
- Poll timeout extended from 300s to 840s (just under the backend's 900s Redis TTL) to give cross-device flows room to breathe.
- Explicit `AWARENESS_HEADLESS=1` / `AWARENESS_HEADLESS=0` env override for manual control.

### Why
- Users running the CLI over SSH or inside Docker containers / Codespaces had no way to complete device auth. The protocol (RFC 8628) already supports headless devices — we just needed the UX to surface the code + URL clearly instead of silently failing to open a browser.

## [0.4.3] - 2026-04-11

### Spec sync
- `awareness-spec.json` synced from backend SSOT. Now includes:
  - `skill` category marked DEPRECATED (F-032 uses the dedicated `skills` table).
  - **Step 5 — F-034 skill crystallization**: agents handling `_skill_crystallization_hint` responses should synthesize repeated patterns into reusable skills via `awareness_record(insights={skills:[...]})`.
  - Updated `write_guide` and `skill_guide` in `init_guides` to reflect crystallization flow.
- All generated rules files now contain the new workflow step, so any IDE (Cursor, VSCode, Windsurf, Claude Code, OpenClaw) that runs `awareness-setup` will pick up F-034 automatically.
