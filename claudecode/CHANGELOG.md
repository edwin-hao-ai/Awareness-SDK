# Changelog

## [0.4.1] - 2026-04-12

### Added (F-035 — headless device auth)
- **`scripts/headless-auth.js`**: shared UX helper with `isHeadlessEnv()`, `openBrowserSilently()`, `renderDeviceCodeBox()`. Auto-detects SSH / Codespaces / Gitpod / no-TTY / missing-DISPLAY.
- **`scripts/setup.js`**: replaces plain `console.log` with a prominent ASCII box showing the verification URL + user code. Skips browser open on headless hosts. Poll timeout aligned with backend's 900s TTL.
- **`scripts/recall.js`**: auto-start device auth now emits a headless-aware `<setup-required>` block. On remote hosts the message instructs the user to open the URL on another device; local hosts keep the original one-click message.
- **`scripts/poll-auth.js`**: default expires_in bumped from 600s to 900s.
- **`skills/setup/SKILL.md`**: embedded Python setup script now detects headless (SSH/Codespaces/no-TTY) and skips browser open, emits new `HEADLESS:0/1`, `TTL:N`, `BROWSER:SKIPPED:{url}` parse lines for the agent to route off. Bash timeout bumped from 300000 ms to 840000 ms.

### Why
- CLAUDE.md requires `sdks/awareness-memory/scripts/` and `sdks/claudecode/scripts/` to stay in lockstep — they serve different distribution channels (ClawHub skill vs CC marketplace) but must share identical behavior. F-035 added headless support to one and this release syncs the other.

## [0.4.0] - 2026-04-11

### Added
- **F-034 `_skill_crystallization_hint` surfacing** (`scripts/record.js`): when the
  daemon or cloud returns `_skill_crystallization_hint` on an ingest response,
  `record.js` now caches a synthetic `crystallization` perception signal. The
  next `UserPromptSubmit` recall injects it into the agent context with explicit
  action guidance — "synthesize the similar cards into a skill and submit via
  `awareness_record(insights={skills:[...]})`".
- **F-033 / F-034 spec alignment**: scripts now honour `perception_signals` and
  `active_skills` returned by the daemon so Claude Code hooks surface the same
  signals the OpenClaw plugin and MCP server do.
- **Harness Engineering upgrade** (`scripts/harness-builder.mjs`): actionable
  rules, rendered context, pitfall guards, and 20k-token recall budget.
- **Multi-project workspace isolation**: recall now respects daemon project roots
  instead of collapsing all history into a single global memory.
- **New helper scripts**: `import.js`, `poll-auth.js`, `sync.js`.

### Changed
- **13-category knowledge-card alignment** (`scripts/record.js`,
  `scripts/shared.js`): record-rule and prompt now list all 13 categories
  (6 engineering + 7 personal), matching the cloud spec and the OpenClaw plugin.
- **Context-first recall**: context blocks are emitted before rules so the
  agent sees past decisions before being reminded of the record protocol.
- **Session ID handling + port conflict handling**: setup/doctor scripts detect
  when daemon port 37800 is taken and surface a clean error instead of hanging.
- **Removed content truncation** on recall output — raw card bodies now flow
  through to the harness with the 20k-token budget.

### Fixed
- `save-memory.js` — ClawHub users were unable to write memories because the
  script was only shipped in the claudecode distribution. Scripts are now
  synchronized between `sdks/claudecode/scripts/` and `sdks/awareness-memory/scripts/`.
- Title metadata leakage in harness output.
- Knowledge card category classification in record-rule prompt.

### Compatibility
- Drop-in compatible with 0.3.0. New perception/skill fields are additive.
- Requires `@awareness-sdk/local` daemon ≥ 0.3.13 or cloud backend with
  `_skill_crystallization_hint` support for the F-034 hint to surface.

### Known issue — marketplace update blocker
- Prior versions of `sdks/.claude-plugin/marketplace.json` carried a hard-coded
  `"version": "0.1.0"` field, which blocked Claude Code's `/plugin update` cache
  invalidation (marketplace.json version is used to key the plugin cache path).
  0.4.0 removes that field so future updates propagate via git SHA as Anthropic's
  official plugins do. Existing installs will stay on 0.3.0 until the user runs
  `/plugin update awareness-memory@awareness`.

## [0.3.0] - 2026-03-30

### Added
- Initial perception (Eywa Whisper) support — record-time push signals.
- setup doctor command + session ID stability.
- Context-first recall alignment.

## [0.1.0] - 2026-02-15

### Added
- Initial release.
- `awareness_init`, `awareness_recall`, `awareness_record`, `awareness_lookup`
  MCP tools via stdio bridge to the Awareness Memory Cloud.
- UserPromptSubmit hook auto-recalls relevant context.
- Stop hook auto-captures session work.
