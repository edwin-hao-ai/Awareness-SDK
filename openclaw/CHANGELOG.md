# Changelog

## [0.5.17] - 2026-04-01

### Fixed
- **Hook migration with backward compatibility**: Migrated `before_agent_start` → `before_prompt_build` for OpenClaw v2026.3.22+. Both hooks are registered simultaneously with prompt-based dedup guard, ensuring the plugin works on both old and new OpenClaw versions.
- **Hash dedup collision fix**: Replaced simple JSHash with `content.slice(0,120)|length` composite key — near-zero collision probability for short messages.
- **Test copy-paste bug**: `hookLegacy` assertion was checking `before_prompt_build` instead of `before_agent_start`.

### Changed
- **Recall threshold lowered**: Score filter reduced from 0.5 → 0.35 to improve recall rate, especially for CJK content with cross-language semantic matching.

## [0.5.16] - 2026-03-31

### Fixed
- **26-issue audit**: Data safety, dedup, i18n, and test fixes across the SDK.

## [0.5.15] - 2026-03-31

### Fixed
- **Local-mode plugin init**: Source isolation and sourceExclude filtering improvements.

## [0.5.14] - 2026-03-27

### Fixed
- **Critical: async register bug** — OpenClaw host ignores async `register()` return values, causing plugin initialization to be silently skipped. Refactored to synchronous `register()` with background daemon health-check via `ensureLocalDaemon()`. Tools and hooks now register immediately (local-first optimistic mode), daemon availability verified asynchronously.
- **Local-first default** — without cloud credentials, plugin now registers full tools/hooks for local daemon mode instead of entering setup-only mode. Setup mode only activates as fallback if daemon check fails in background.

### Changed
- Updated tests to reflect new sync register + local-first behavior (139 tests passing)

## [0.5.13] - 2026-03-27

### Fixed
- **Plugin version sync**: `openclaw.plugin.json` version was stuck at `0.1.10` — OpenClaw host displayed wrong version to users. Now synced to match `package.json`

## [0.5.12] - 2026-03-27

### Added
- **One-time dashboard welcome**: on first local daemon connection, injects `<dashboard>` element into `<awareness-memory>` block telling user the dashboard URL (http://localhost:PORT). Uses `~/.awareness/dashboard-welcomed` marker to show only once.
- Made `AwarenessClient.isLocal` public (was private) so hooks can check mode

## [0.5.11] - 2026-03-27

### Fixed
- **Device auth URL injection format**: Changed `before_agent_start` hook from `prependSystemContext` to `<awareness-memory>` XML block with `<setup-required>` element — LLMs reliably display this format when user asks about memory
- **Tested**: Verified with qwen-turbo: "我想启用记忆功能" → agent immediately returns device auth URL with `?code=` param

## [0.5.10] - 2026-03-27

### Changed
- **Auto device auth in `before_agent_start` hook**: when no credentials are configured, the hook now automatically calls `/auth/device/init` and injects the login URL directly into the agent's system context — user just starts a conversation and the agent immediately shows them the link. No tool call required.
- Fixed hook registration: changed from `api.registerHook()` to `api.on()` (correct OpenClaw API)

## [0.5.9] - 2026-03-27

### Fixed
- **Device auth `memoryId` parsing**: `/memories` API returns a plain array, not `{ memories: [...] }` — poll-auth.js now handles both formats correctly
- **Device auth URL**: `auth_url` now includes `?code=` query param so `cli-auth` page auto-fills the code (avoids "Missing Code" error)

## [0.5.8] - 2026-03-27

### Added
- **Device Auth Flow** for mobile/Android users: call `awareness_setup(action='start_auth')` to get a URL+code for browser-based login — no manual config editing required
  - Phase 1 (`start_auth`): calls `/auth/device/init`, spawns `poll-auth.js` as detached background process, returns `{auth_url, user_code}`
  - Phase 2 (`check_auth`): reads `~/.awareness/device-auth-result.json`, returns success if approved
  - `poll-auth.js`: background poller that writes `apiKey + memoryId` to `~/.openclaw/openclaw.json` when device is approved
- **Termux/Android detection**: skips the 8-second daemon auto-start loop on Android (detects via `TERMUX_VERSION` env or `PREFIX` path), removing an 8s startup penalty for mobile users
- Updated `prependSystemContext` hint to guide users toward `start_auth` action instead of command-line alternatives

## [0.5.7] - 2026-03-27

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

## [0.5.6] - 2026-03-27

### Added
- **Perception (Eywa Whisper) support**: record-time push signals now cached and injected into next auto-recall
- `cachePerception()` in hooks.ts and tools.ts writes signals to `~/.awareness/perception-cache.json`
- `consumePerception()` in auto-recall hook reads + clears signals (30-min TTL, max 5 per injection)
- `<perception>` XML block with `<action-required>` directive injected into LLM system context
- Perception signals from both auto-capture and manual awareness_record tool calls are cached

## [0.5.5] - 2026-03-27

### Fixed
- **Local daemon mode**: client now uses MCP JSON-RPC (`/mcp`) instead of cloud REST paths that don't exist on local daemon
- Auto-recall hook now works in local mode (was getting 404 on `/memories/{id}/context`)
- Auto-capture hook now works in local mode (was getting 404 on `/mcp/events`)
- All awareness_* tool calls (init, recall, record, lookup) now work via MCP in local mode

### Added
- `isLocal` detection in AwarenessClient (empty apiKey + localhost URL)
- `mcpCall()` / `mcpCallRaw()` helpers for MCP JSON-RPC protocol
- Local recall response parsing: converts MCP two-block format to RecallResult

## [0.1.3] - 2026-03-14

### Fixed
- Corrected API key prefix in example config (`ak-` → `aw_`)
- Corrected local development install path in README (`./sdks/openclaw` → `./openclaw`)

## [0.1.2] - 2026-03-12

### Changed
- Renamed the public hybrid search option to `full-text` wording while keeping runtime compatibility for older callers.
- Updated the tool schema to expose `full_text_weight` instead of the internal algorithm label.

### Fixed
- Ensured `full_text_weight` is forwarded in the retrieve payload for OpenClaw callers.

## [0.1.1] - 2026-03-12

### Fixed
- Sent `confidence_threshold` and `include_installed` as top-level retrieve payload fields so the plugin matches the backend API contract.
- Updated plugin tests to verify the corrected request shape.

## [0.1.0] - 2026-03-09

### Added
- Initial OpenClaw plugin release.
- Awareness-backed memory recall, lookup, and recording tools.
