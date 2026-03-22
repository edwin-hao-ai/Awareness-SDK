# Changelog

## [2.0.0] - 2026-03-22

### Breaking Changes

The following deprecated methods have been **removed**. Update your code before upgrading:

| Removed | Replace with |
|---------|-------------|
| `remember_step(memory_id, text, ...)` | `record(memory_id, content=text, ...)` |
| `remember_batch(memory_id, steps, ...)` | `record(memory_id, content=steps, ...)` |
| `ingest_content(memory_id, content, ...)` | `record(memory_id, content=content, scope="knowledge")` |
| `backfill_conversation_history(memory_id, messages, ...)` | `record(memory_id, content=messages, scope="timeline")` |

The following methods are now **private** (prefixed with `_`). Use `record()` instead for new code:

| Now private | Replacement |
|------------|-------------|
| `submit_insights()` → `_submit_insights()` | `record(memory_id, insights={...})` |
| `begin_memory_session()` → `_begin_memory_session()` | Session is now managed automatically by `record()` |

### Added

- `mode` parameter on `MemoryCloudClient.__init__`: `"cloud"` (default) | `"local"` | `"auto"`
  - `mode="local"` — connect to a local Awareness daemon instead of the cloud API
  - `mode="auto"` — try local daemon first, fall back to cloud if unavailable
- `local_url` parameter on `MemoryCloudClient.__init__`: local daemon URL (default: `http://localhost:8765`)

```python
# Connect to local daemon
client = MemoryCloudClient(mode="local")

# Auto-detect (local first, cloud fallback)
client = MemoryCloudClient(
    mode="auto",
    local_url="http://localhost:8765",
    base_url="https://api.awareness.market",
    api_key="sk-...",
)
```

## [0.2.8] - 2026-03-22

### Added
- `detail` and `ids` parameters on `retrieve()` and `recall_for_task()` for progressive disclosure

## [0.2.2] - 2026-03-16

### Added
- `ActiveSkill` type (`title`, `summary`, `methods`) for reusable procedure prompts
- `active_skills` field on `SessionContextResult` — pre-loaded at session start for token efficiency
- `skill` as a new knowledge card category (reusable procedure done 2+ times)

## [0.2.1] - 2026-03-14

### Fixed
- Corrected example file references in README (removed non-existent files, added `injected_conversation_demo.py`)

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
