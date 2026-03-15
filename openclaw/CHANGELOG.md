# Changelog

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
