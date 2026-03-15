# Changelog

## [0.2.1] - 2026-03-14

### Fixed
- Corrected local development path in README (`cd sdks/typescript` → `cd typescript`)

## [0.2.0] - 2026-03-09

### Added
- `userId` parameter on all write and read methods for multi-user memory
- `agentRole` parameter for role-filtered recall
- `reconstructChunks` and `maxStitchedChars` on `retrieve()` and `recallForTask()`
- `multiLevel` and `clusterExpand` parameters for broader context and topic-based retrieval
- 13 knowledge card categories (6 engineering + 7 personal)

### Changed
- Default `retrieve()` limit: 10 → 12
- Default `recallForTask()` limit: 8 → 12, max: 20 → 30
- `recallForTask()` now uses `useHybridSearch: true` by default

## [0.1.0] - 2026-02-15

### Added
- Initial release
- `MemoryCloudClient` with CRUD operations
- `retrieve()` and `recallForTask()` for semantic search
- `ingest()` for bulk content import
- ZIP archive export support
