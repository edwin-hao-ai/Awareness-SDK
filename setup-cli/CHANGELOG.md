# Changelog

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
