# Changelog

## [2.4.3] - 2026-04-11

### Fixed (real local-mode bridge — supersedes the v2.4.2 default-port "fix")
- **`mode: "local"` now actually talks to the local daemon**: v2.4.0–v2.4.2 all
  pretended local mode existed but pointed at non-existent ports. v2.4.2 changed
  the default to `http://localhost:8000/api/v1` (a self-hosted Awareness backend),
  which still didn't match what users mean when they say "local mode" — i.e. the
  `@awareness-sdk/local` daemon (single-tenant, port 37800). v2.4.3 makes
  `mode: "local"` route the four daemon-supported MCP tools (`awareness_init`,
  `awareness_recall`, `awareness_record`, `awareness_lookup`) through the daemon's
  `/mcp` JSON-RPC endpoint at `http://localhost:37800`. This is a real, end-to-end
  tested integration — verified live against a running daemon.
- **`mode: "cloud"` default base URL is now the public Awareness Cloud**:
  `https://awareness.market/api/v1` (was missing or pointed at dev). No more
  silently calling `localhost:8000`.
- **`localUrl` default is `http://localhost:37800`** (the daemon root, not an
  `/api/v1` REST path). The bridge talks JSON-RPC at `${localUrl}/mcp`.

### Added
- **MCP-bridged methods (work in `mode: "local"` or `mode: "auto"`)**:
  - `record()` → `awareness_record` (string → `remember`, array → `remember_batch`)
  - `retrieve()` → `awareness_recall` (markdown summary parsed into structured items)
  - `getSessionContext()` → `awareness_init`
  - `getKnowledgeBase()` → `awareness_lookup` `type=knowledge`
  - `getPendingTasks()` → `awareness_lookup` `type=tasks`
- **`callLocalDaemon(toolName, args)`** — public escape hatch for direct MCP tool
  calls; throws `MemoryCloudError("LOCAL_NOT_SUPPORTED", ...)` for non-allowlisted
  tools. The four supported tools are exported via `DAEMON_SUPPORTED_TOOLS`.
- **Markdown recall parser**: `awareness_recall` returns a markdown summary on the
  daemon side; the SDK now parses it into `{ id, type, title, snippet, score }`
  items so `RetrieveResponse.results` has a stable shape across cloud and local.
- **Hard guards**: cloud-only methods (`createMemory`, `listMemories`) throw
  `LOCAL_NOT_SUPPORTED` instead of silently 404ing against the daemon.

### Compatibility
- Anyone passing `localUrl` explicitly is unaffected.
- Anyone relying on `mode: "local"` previously would have always seen connection
  errors (port 8765 / port 8000), so no real workflow can break.
- Cloud mode is unchanged for clients passing `baseUrl: "https://awareness.market/api/v1"`.

## [2.4.2] - 2026-04-11

### Fixed
- **`localUrl` default port was wrong (vaporware)**: Default `localUrl` was `http://localhost:8765` since v0.x, but no Awareness component has ever served port 8765 — the cloud backend serves 8000 (docker-compose) and the local daemon serves 37800. So `mode: "local"` and `mode: "auto"` have **never worked** against any real deployment. Default is now `http://localhost:8000/api/v1` (matches `docker-compose up`).
- **Local mode semantics clarified**: `mode: "local"` means "self-hosted Awareness backend" (same REST shape as cloud, just a different host). It is **NOT** the `@awareness-sdk/local` daemon (port 37800) — that has a different REST shape (single-tenant, `/api/v1/topics`, `/api/v1/perceptions`, …) and should be consumed via `@awareness-sdk/local` or `@awareness-sdk/openclaw-memory`. JSDoc on `MemoryCloudClientConfig.mode` and `localUrl` documents this clearly.

### Compatibility
- Pure default-value change. Anyone passing `localUrl` explicitly is unaffected.
- Anyone relying on the broken 8765 default would have always seen connection errors, so no real workflow can break.

## [2.4.1] - 2026-04-11

### Added
- **`SkillCrystallizationHint` interface** — exported from the main entry. Describes the F-034 hint shape returned by `awareness_record` / ingest endpoints when ≥3 similar knowledge cards have accumulated. Agents should synthesize the listed `similar_cards` into a skill via `record(insights={skills:[...]})`.
- **`IngestEventsResponse._skill_crystallization_hint`** — new optional field on the ingest response so TypeScript consumers can read the hint without resorting to `(response as any)`.
- **`PerceptionSignal.type`** now includes `"guard"` and `"crystallization"` — guards are blocking pitfall warnings (highest priority), and crystallization is the synthetic signal type emitted client-side when the SDK forwards `_skill_crystallization_hint`.
- **`PerceptionSignal` lifecycle fields** — `signal_id`, `state` (`active | snoozed | dismissed | auto_resolved | dormant`), `exposure_count`, `current_weight`. Mirrors the local daemon's perception lifecycle so cloud SDK consumers can implement the same exposure-cap / decay UX.
- **`ActiveSkill.id` / `decay_score` / `usage_count`** — additional fields returned by the cloud `/skills` endpoint, useful for displaying skill freshness in custom UIs.

### Documentation
- `KnowledgeCard.category` JSDoc now marks `skill` as **DEPRECATED (F-032)** — skills live in the dedicated `skills` table since v2.4.0. Existing `skill`-category cards are kept for legacy display only.

### Compatibility
- Pure type-additive change. No runtime behavior changed. Drop-in compatible with v2.4.0.
- Tested against the unchanged client.ts — all 51 unit tests still pass (3 pre-existing failures unrelated).

## [2.4.0] - 2026-04-10

### Added
- `getSkills()` — List skills for a memory with filtering and sorting
- `markSkillUsed()` — Mark a skill as used, resetting decay timer
- `Skill`, `SkillMethod`, `SkillTrigger`, `SkillListResponse`, `SkillUpdateInput` types
- Skill system support for F-032 (Hermes Agent-style auto-extracted skills)

## [2.0.0] - 2026-03-22

### Breaking Changes

The following deprecated methods have been **removed**. Update your code before upgrading:

| Removed | Replace with |
|---------|-------------|
| `rememberStep({ memoryId, content, ... })` | `record({ memoryId, content, ... })` |
| `rememberBatch({ memoryId, steps, ... })` | `record({ memoryId, content: steps, ... })` |
| `ingestContent({ memoryId, content, ... })` | `record({ memoryId, content, scope: "knowledge" })` |
| `backfillConversationHistory({ memoryId, messages, ... })` | `record({ memoryId, content: messages, scope: "timeline" })` |

The following methods are now **private**. Use `record()` instead for new code:

| Now private | Replacement |
|------------|-------------|
| `submitInsights()` → `_submitInsights()` | `record({ memoryId, insights: {...} })` |
| `beginMemorySession()` → `_beginMemorySession()` | Session is now managed automatically by `record()` |

### Added

- `mode` field on `MemoryCloudClientConfig`: `"cloud"` (default) | `"local"` | `"auto"`
  - `mode: "local"` — connect to a local Awareness daemon instead of the cloud API
  - `mode: "auto"` — try local daemon first, fall back to cloud if unavailable
- `localUrl` field on `MemoryCloudClientConfig`: local daemon URL (default: `"http://localhost:8765"`)
- `baseUrl` is now optional (not required when using `mode: "local"`)

```typescript
// Connect to local daemon
const client = new MemoryCloudClient({ mode: "local" });

// Auto-detect (local first, cloud fallback)
const client = new MemoryCloudClient({
  mode: "auto",
  localUrl: "http://localhost:8765",
  baseUrl: "https://api.awareness.market",
  apiKey: "sk-...",
});
```

## [0.2.6] - 2026-03-22

### Added
- `detail` and `ids` parameters on `retrieve()` and `recallForTask()` for progressive disclosure

## [0.2.2] - 2026-03-16

### Added
- `ActiveSkill` interface (`title`, `summary`, `methods`) for reusable procedure prompts
- `active_skills` field on `SessionContextResponse` — pre-loaded at session start for token efficiency
- `skill` as a new knowledge card category (reusable procedure done 2+ times)

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
