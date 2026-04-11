# Changelog

## [2.4.3] - 2026-04-11

### Fixed (real local-mode bridge — supersedes the v2.4.2 default-port "fix")
- **`mode="local"` now actually talks to the local daemon**: v2.4.0–v2.4.2 all
  pretended local mode existed but pointed at non-existent ports. v2.4.2 changed
  the default to `http://localhost:8000/api/v1` (a self-hosted Awareness backend),
  which still didn't match what users mean when they say "local mode" — i.e. the
  `@awareness-sdk/local` daemon (single-tenant, port 37800). v2.4.3 makes
  `mode="local"` route the four daemon-supported MCP tools (`awareness_init`,
  `awareness_recall`, `awareness_record`, `awareness_lookup`) through the daemon's
  `/mcp` JSON-RPC endpoint at `http://localhost:37800`. This is a real, end-to-end
  tested integration — verified live against a running daemon.
- **`mode="cloud"` default base URL is now the public Awareness Cloud**:
  `https://awareness.market/api/v1`. `base_url` is now optional (defaulting to
  this value) instead of being a required positional arg.
- **`local_url` default is `http://localhost:37800`** (the daemon root, not an
  `/api/v1` REST path). The bridge talks JSON-RPC at `${local_url}/mcp`.

### Added
- **MCP-bridged methods (work in `mode="local"` or `mode="auto"`)**:
  - `record()` → `awareness_record` (string → `remember`, list → `remember_batch`)
  - `retrieve()` → `awareness_recall` (markdown summary parsed into structured items)
  - `get_session_context()` → `awareness_init`
  - `get_knowledge_base()` → `awareness_lookup` `type=knowledge`
  - `get_pending_tasks()` → `awareness_lookup` `type=tasks`
- **`call_local_daemon(tool_name, args)`** — public escape hatch for direct MCP
  tool calls; raises `MemoryCloudError("LOCAL_NOT_SUPPORTED", ...)` for non-allow-
  listed tools. The four supported tools are exported via `DAEMON_SUPPORTED_TOOLS`.
- **Markdown recall parser**: `awareness_recall` returns a markdown summary on the
  daemon side; the SDK now parses it into `{id, type, title, snippet, score}`
  items so `retrieve()` returns a stable shape across cloud and local.
- **Hard guards**: cloud-only methods (`create_memory`, `list_memories`) raise
  `LOCAL_NOT_SUPPORTED` instead of silently 404ing against the daemon.

### Compatibility
- `base_url` is now optional. Existing positional callers still work; explicit
  `base_url` keeps the old behavior of pointing at a custom REST host.
- Anyone passing `local_url` explicitly is unaffected.
- Anyone relying on `mode="local"` previously would have always seen connection
  errors (port 8765 / port 8000), so no real workflow can break.

## [2.4.2] - 2026-04-11

### Fixed
- **`local_url` default port was wrong (vaporware)**: Default `local_url` was
  `http://localhost:8765`, but no Awareness component has ever served port 8765 —
  the cloud backend serves 8000 (docker-compose) and the local daemon serves 37800.
  So `mode="local"` and `mode="auto"` **never worked** against any real deployment.
  Default is now `http://localhost:8000/api/v1` (matches `docker-compose up`).
- **`mode="auto"` health probe was wrong path**: when `local_url` ended in `/api/v1`,
  the auto-mode probe hit `/api/v1/health` (404), so auto fallback to cloud always fired.
  Probe now strips the `/api/v1` suffix and pings `/health` at the host root.
- **Docstring clarified**: `mode="local"` means a self-hosted Awareness backend
  (same REST shape as cloud). It is **NOT** the `@awareness-sdk/local` daemon
  (port 37800) — that has a different REST shape (single-tenant, `/api/v1/topics`,
  `/api/v1/perceptions`, …) and should be consumed via the daemon's own client or
  `@awareness-sdk/openclaw-memory`.

### Compatibility
- Pure default-value change. Anyone passing `local_url` explicitly is unaffected.
- Anyone relying on the broken 8765 default would have always seen connection errors,
  so no real workflow can break.

## [2.4.1] - 2026-04-11

### Added
- **`SkillCrystallizationHint` TypedDict** — describes the F-034 hint shape returned in
  `IngestResult._skill_crystallization_hint` when ≥3 similar knowledge cards have
  accumulated. Agents should synthesize the listed `similar_cards` into a skill via
  `record(insights={"skills": [{"name", "summary", "methods", "trigger_conditions",
  "tags", "source_card_ids"}]})`.
- **`IngestResult._skill_crystallization_hint`** — new optional field on the ingest
  response for type-safe access to the hint.
- **`PerceptionSignal.type`** docstring now lists `"guard"` (highest-priority pitfall
  warning) and `"crystallization"` (synthetic signal carrying the F-034 hint).
- **`PerceptionSignal` lifecycle fields** — `signal_id`, `state`, `exposure_count`,
  `current_weight`. Mirrors the local daemon's perception lifecycle so cloud SDK
  consumers can implement matching exposure-cap / decay UX.
- **`ActiveSkill.id` / `decay_score` / `usage_count`** — additional fields returned by
  the cloud `/skills` endpoint, useful for displaying skill freshness in custom UIs.

### Documentation
- `KnowledgeCard.category` comment now marks `skill` as **DEPRECATED (F-032)** — skills
  live in the dedicated `skills` table since v2.4.0.

### Compatibility
- Pure type-additive change. No runtime behavior changed. Drop-in compatible with v2.4.0.
- 119 of 122 unit tests pass (3 pre-existing failures unrelated to this change).

## [2.4.0] - 2026-04-10

### Added
- `get_skills()` — List skills for a memory with filtering and sorting
- `mark_skill_used()` — Mark a skill as used, resetting decay timer
- `Skill`, `SkillMethod`, `SkillTrigger`, `SkillListResponse`, `SkillUpdateInput` types
- Skill system support for F-032 (Hermes Agent-style auto-extracted skills)

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
