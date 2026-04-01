import fs from 'node:fs';
import path from 'node:path';

/**
 * Start watching the local memories directory and debounce reindexing.
 * Returns the watcher instance or null when watching is unavailable.
 */
export function startFileWatcher(daemon) {
  const memoriesDir = path.join(daemon.awarenessDir, 'memories');
  if (!fs.existsSync(memoriesDir)) return null;

  try {
    return fs.watch(memoriesDir, { recursive: true }, () => {
      if (daemon._reindexTimer) clearTimeout(daemon._reindexTimer);
      daemon._reindexTimer = setTimeout(async () => {
        try {
          if (daemon.indexer && daemon.memoryStore) {
            const result = await daemon.indexer.incrementalIndex(daemon.memoryStore);
            if (result.indexed > 0) {
              console.log(`[awareness-local] auto-indexed ${result.indexed} changed files`);
            }
          }
        } catch (err) {
          console.error('[awareness-local] auto-reindex error:', err.message);
        }
      }, daemon._reindexDebounceMs);
    });
  } catch (err) {
    console.error('[awareness-local] fs.watch setup failed:', err.message);
    return null;
  }
}
