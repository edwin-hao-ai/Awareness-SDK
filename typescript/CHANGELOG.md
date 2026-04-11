# Changelog

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
