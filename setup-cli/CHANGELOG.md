# Changelog

## [0.4.3] - 2026-04-11

### Spec sync
- `awareness-spec.json` synced from backend SSOT. Now includes:
  - `skill` category marked DEPRECATED (F-032 uses the dedicated `skills` table).
  - **Step 5 — F-034 skill crystallization**: agents handling `_skill_crystallization_hint` responses should synthesize repeated patterns into reusable skills via `awareness_record(insights={skills:[...]})`.
  - Updated `write_guide` and `skill_guide` in `init_guides` to reflect crystallization flow.
- All generated rules files now contain the new workflow step, so any IDE (Cursor, VSCode, Windsurf, Claude Code, OpenClaw) that runs `awareness-setup` will pick up F-034 automatically.
