# Changelog

## [0.2.0] - 2026-03-09

### Added
- `user_id` parameter on all write and read methods for multi-user memory
- `agent_role` parameter for role-filtered recall
- `reconstruct_chunks` and `max_stitched_chars` on `retrieve()` and `recall_for_task()`
- `multi_level` and `cluster_expand` parameters for broader context and topic-based retrieval
- 13 knowledge card categories (6 engineering + 7 personal)

### Changed
- Default `retrieve()` limit: 10 → 12
- Default `recall_for_task()` limit: 8 → 12, max: 20 → 30
- `recall_for_task()` now uses `use_hybrid_search=True` by default

## [0.1.0] - 2026-02-15

### Added
- Initial release
- `MemoryCloudClient` with CRUD operations
- `retrieve()` and `recall_for_task()` for semantic search
- `ingest()` for bulk content import
- OpenAI, Anthropic, LangChain, CrewAI, AutoGen integrations
