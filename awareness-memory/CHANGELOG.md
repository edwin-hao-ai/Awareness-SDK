# Changelog

## [0.3.2] - 2026-04-11

Same as 0.3.1. Version bumped because 0.3.1 was already reserved on ClawHub from an earlier test publish.

## [0.3.1] - 2026-04-11

### Added
- **F-034 `_skill_crystallization_hint` surfacing**: `record.js` now caches a synthetic `crystallization` signal into `perception-cache.json` when the daemon/cloud returns `_skill_crystallization_hint`. The next `UserPromptSubmit` recall injects it into the agent context with explicit action guidance: "synthesize the similar cards into a skill and submit via `awareness_record(insights={skills:[...]})`".
- **Crystallization in `<action-required>`**: `recall.js` extends the perception action-required block with a crystallization branch so agents know exactly what to do when they see the synthetic signal.

### Spec sync
- `awareness-spec.json` synced from backend SSOT (step 5 crystallization, deprecated `skill` category).

### Compatibility
- Fully backward compatible with local daemon v0.5.13+ and v0.5.16 (perception center).
- Works in both cloud mode and local-daemon mode — the `_skill_crystallization_hint` shape is identical across both.
