# Changelog

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
