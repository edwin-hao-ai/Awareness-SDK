# Changelog

## [0.5.0] - 2026-04-01

### Changed
- **Major daemon refactor**: Extracted 1500+ lines from monolithic `daemon.mjs` into 12 focused modules under `daemon/` directory — constants, helpers, loaders, MCP contract/handlers, HTTP handlers, API handlers, tool bridge, cloud HTTP, file watcher, embedding helpers.
- **MCP server simplified**: `mcp-server.mjs` now delegates result building to `daemon/mcp-handlers.mjs`, reducing duplication between HTTP and stdio transports.
- **MCP stdio cleanup**: `mcp-stdio.mjs` uses shared enum constants and error helpers from `daemon/mcp-contract.mjs`.

### Added
- **Noise filter**: New `core/noise-filter.mjs` filters low-signal events (empty session checkpoints, terse untitled content) before storage, reducing memory clutter.
- **Knowledge card evolution**: Semantic dedup via embedding cosine similarity during card extraction — detects duplicates, updates, and contradictions.
- **Test suite**: 14 unit tests covering MCP contract, HTTP dispatch, noise filter, recall regressions, and embedding compatibility.

### Fixed
- **Port resolution bug**: `cmdStatus` and `cmdReindex` now correctly pass `projectDir` to `resolvePort()` for workspace registry lookup.

## [0.4.6] - 2026-04-01

### Added
- **CJK auto-detection + multilingual embedding lazy loading**: `detectNeedsCJK()` samples text for CJK character ratio (>5% threshold). When CJK content is detected, automatically loads `multilingual-e5-small` model on demand. English-only `all-MiniLM-L6-v2` remains the fast default.
- **Shared lang-detect module**: Extracted `detectNeedsCJK()` to `core/lang-detect.mjs` to avoid logic drift between daemon and search.
- **Model-aware vector search**: `search.mjs` now reads `model_id` from stored embeddings and matches each against the correct query vector — no more cross-model-space similarity comparisons.
- **Status endpoint enhancements**: `/status` now reports `multilingual_model` name and `auto_cjk_detection: true`.

### Changed
- `indexer.mjs`: `getAllEmbeddings()` now returns `model_id` field for each embedding.

## [0.4.5] - 2026-03-31

### Fixed
- **26-issue audit**: Data safety, dedup, i18n, and test fixes.

## [0.4.4] - 2026-03-31

### Fixed
- **Source isolation and sourceExclude filtering**.

## [0.4.3] - 2026-03-30

### Fixed
- **Content truncation removed**: Added 20k token budget, multi-project workspace isolation.

## [0.4.2] - 2026-03-30

### Added
- **healthz embedding diagnostics**: `/healthz` endpoint now includes `embedding` object with `available` boolean and `model` name, making it easier for desktop apps to display embedding status.

### Improved
- **Embedding warmup diagnostics**: When embedding model warmup fails, daemon now logs specific causes (network timeout, disk full, corrupted cache) and suggests fix commands (`rm -rf ~/.cache/huggingface/hub`). Previously only showed generic error message.
- **Warmup timing**: Logs exact warmup duration in seconds for performance monitoring.

## [0.4.0] - 2026-03-29

### Added
- **Hybrid vector+FTS5 search (out of the box)**: SearchEngine now receives the embedder module, enabling dual-channel search (BM25 keyword + embedding cosine similarity) with Reciprocal Rank Fusion (RRF). Previously only FTS5 was active despite the code being present.
- **Auto embedding on write**: Every new memory is automatically embedded and stored in SQLite on `awareness_record`, no manual step needed.
- **Startup model pre-warming**: Embedding model (~23MB, Xenova/all-MiniLM-L6-v2) is downloaded and warmed up in the background on first daemon start. Subsequent starts use cached model.
- **Automatic embedding backfill**: On startup, memories without embeddings are backfilled in the background — existing users get vector search for all historical memories without any action.
- **healthz search_mode field**: `/healthz` endpoint now reports `search_mode: "hybrid"` or `"fts5-only"` so plugins can detect search capabilities.

### Changed
- **@huggingface/transformers promoted to required dependency**: Moved from `optionalDependencies` to `dependencies` to ensure vector search works out of the box via `npx`.
- **Shared embedder loading**: `_loadEmbedder()` is now a shared lazy-loader used by both SearchEngine and KnowledgeExtractor (was duplicated before).

## [0.3.12] - 2026-03-27

### Fixed
- **Knowledge card category fix (proper approach)**: Replaced hardcoded English alias map with proper fix at source — `awareness_record` MCP tool schema now explicitly enumerates all 13 valid categories in `describe()`. LLMs read the schema and output valid values directly. `normalizeCategory()` simplified to case/whitespace normalization + strict `VALID_CATEGORIES` lookup + fallback `key_point`. No language-specific aliases needed.

## [0.3.11] - 2026-03-27

### Fixed
- **Windows Chinese/CJK text rendering**: Force UTF-8 encoding on Windows for daemon process stdout/stderr and MCP stdio stdin/stdout/stderr — prevents Chinese characters from becoming "????" on Windows systems with non-UTF-8 code pages (e.g., CP936/GBK)

### Fixed (knowledge-extractor)
- **Non-standard knowledge card categories**: `processPreExtracted()` now normalizes LLM-generated categories via `normalizeCategory()`. Maps TROUBLESHOOTING → `problem_solution`, BEST-PRACTICE → `insight`, SETUP → `workflow`, etc. — no more unlisted categories appearing in the dashboard or being silently downgraded to `key_point` during cloud sync

## [0.3.10] - 2026-03-27

### Added
- Initial CHANGELOG (backfilled from git history)
