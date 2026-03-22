/**
 * Config Manager for Awareness Local
 *
 * Handles:
 *   - Device ID generation (unique per machine)
 *   - .awareness/ directory scaffolding + .gitignore
 *   - config.json creation, loading, and updating
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AWARENESS_DIR = '.awareness';
const CONFIG_FILENAME = 'config.json';

/** Subdirectories to create inside .awareness/ */
const SUBDIRS = [
  'memories',
  'knowledge',
  'knowledge/decisions',
  'knowledge/solutions',
  'knowledge/workflows',
  'knowledge/insights',
  'tasks',
  'tasks/open',
  'tasks/done',
];

/** Files/patterns that must NOT be committed to Git */
const GITIGNORE_CONTENT = `# SQLite index (rebuilt locally on each device)
index.db
index.db-journal
index.db-wal

# Daemon runtime files
daemon.pid
daemon.log

# Cloud sync credentials (security-sensitive)
config.json
`;

/** Default configuration matching spec section 7.5 */
const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  daemon: {
    port: 37800,
    auto_start: true,
    log_level: 'info',
  },
  device: {
    id: '',   // filled by generateDeviceId()
    name: '', // filled by hostname
  },
  agent: {
    default_role: 'builder_agent',
  },
  extraction: {
    enabled: true,
  },
  embedding: {
    language: 'english',
    model_id: null,
  },
  cloud: {
    enabled: false,
    api_base: 'https://awareness.market/api/v1',
    api_key: '',
    memory_id: '',
    auto_sync: true,
    sync_interval_min: 5,
    last_push_at: null,
    last_pull_at: null,
    push_cursor: null,
    pull_cursor: null,
  },
  git_sync: {
    enabled: true,
    auto_commit: false,
    branch: null,
  },
});

// ---------------------------------------------------------------------------
// Device ID
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic-ish device fingerprint.
 * Format: "{platform}-{hostname-slug}-{4-hex}"
 *
 * The 4-hex suffix is derived from a hash of hostname + homedir + platform
 * so it is stable across restarts but distinct across machines.
 *
 * @returns {string} e.g. "mac-edwins-mbp-a3f2"
 */
export function generateDeviceId() {
  const hostname = os.hostname().toLowerCase();
  const platform = processPlatformLabel();
  const slug = slugify(hostname, 20);

  // Deterministic short hash based on multiple machine signals
  const raw = `${os.hostname()}|${os.homedir()}|${os.platform()}|${os.arch()}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const suffix = hash.slice(0, 4);

  return `${platform}-${slug}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Directory scaffolding
// ---------------------------------------------------------------------------

/**
 * Create the full .awareness/ directory tree and write .gitignore.
 * Safe to call multiple times (idempotent).
 *
 * @param {string} projectDir - Absolute path to the project root
 * @returns {string} Absolute path to the .awareness/ directory
 */
export function ensureLocalDirs(projectDir) {
  const awarenessDir = path.join(projectDir, AWARENESS_DIR);

  // Create root dir
  fs.mkdirSync(awarenessDir, { recursive: true });

  // Create all subdirectories
  for (const sub of SUBDIRS) {
    fs.mkdirSync(path.join(awarenessDir, sub), { recursive: true });
  }

  // Write .gitignore (overwrite every time to keep it in sync with spec)
  const gitignorePath = path.join(awarenessDir, '.gitignore');
  fs.writeFileSync(gitignorePath, GITIGNORE_CONTENT, 'utf-8');

  return awarenessDir;
}

// ---------------------------------------------------------------------------
// Config CRUD
// ---------------------------------------------------------------------------

/**
 * Return the absolute path to .awareness/config.json
 *
 * @param {string} projectDir
 * @returns {string}
 */
export function getConfigPath(projectDir) {
  return path.join(projectDir, AWARENESS_DIR, CONFIG_FILENAME);
}

/**
 * Create config.json with all defaults.  If the file already exists it is
 * left untouched (use loadLocalConfig + saveCloudConfig to modify).
 *
 * @param {string} projectDir
 * @returns {object} The config object that was written (or already existed)
 */
export function initLocalConfig(projectDir) {
  const configPath = getConfigPath(projectDir);

  // Idempotent — never overwrite an existing config
  if (fs.existsSync(configPath)) {
    return loadLocalConfig(projectDir);
  }

  // Ensure parent dirs exist
  ensureLocalDirs(projectDir);

  const deviceId = generateDeviceId();
  const deviceName = os.hostname();

  const config = deepClone(DEFAULT_CONFIG);
  config.device.id = deviceId;
  config.device.name = deviceName;

  // SECURITY C6: Atomic write (tmp+rename) to prevent corruption on crash
  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmpPath, configPath);
  return config;
}

/**
 * Read and return config.json.  Missing keys are filled from DEFAULT_CONFIG
 * so callers always get a complete shape.
 *
 * @param {string} projectDir
 * @returns {object}
 */
export function loadLocalConfig(projectDir) {
  const configPath = getConfigPath(projectDir);

  if (!fs.existsSync(configPath)) {
    // Return defaults without writing — caller may want to init explicitly
    const fallback = deepClone(DEFAULT_CONFIG);
    fallback.device.id = generateDeviceId();
    fallback.device.name = os.hostname();
    return fallback;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const saved = JSON.parse(raw);
    // Merge saved over defaults so new keys added in future versions are present
    return deepMerge(deepClone(DEFAULT_CONFIG), saved);
  } catch (err) {
    // Corrupted JSON — return defaults rather than crash
    const fallback = deepClone(DEFAULT_CONFIG);
    fallback.device.id = generateDeviceId();
    fallback.device.name = os.hostname();
    return fallback;
  }
}

/**
 * Update the cloud section of config.json after device-auth completes.
 *
 * @param {string} projectDir
 * @param {{ apiKey: string, memoryId: string, apiBase?: string }} cloudOpts
 * @returns {object} The updated full config
 */
export function saveCloudConfig(projectDir, { apiKey, memoryId, apiBase }) {
  const config = loadLocalConfig(projectDir);

  config.cloud.enabled = true;
  config.cloud.api_key = apiKey;
  config.cloud.memory_id = memoryId;
  if (apiBase) {
    config.cloud.api_base = apiBase;
  }

  const configPath = getConfigPath(projectDir);
  ensureLocalDirs(projectDir);
  // SECURITY C6: Atomic write
  const tmpPath = configPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(tmpPath, configPath);

  return config;
}

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

/** Map os.platform() to a short human label */
function processPlatformLabel() {
  const p = os.platform();
  if (p === 'darwin') return 'mac';
  if (p === 'win32') return 'win';
  if (p === 'linux') return 'linux';
  return p;
}

/**
 * Turn an arbitrary string into a URL/filename-safe slug.
 * Non-ASCII chars are removed, spaces/underscores become hyphens, consecutive
 * hyphens are collapsed, and the result is trimmed to maxLen.
 */
function slugify(text, maxLen = 50) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
}

/** Structured clone polyfill for plain objects */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Recursively merge `source` into `target`.
 * - Scalar values in source overwrite target
 * - Objects are merged recursively
 * - Arrays in source overwrite target (no concat)
 */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    // SECURITY H7: Prevent prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const srcVal = source[key];
    const tgtVal = target[key];

    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      target[key] = deepMerge(tgtVal, srcVal);
    } else {
      target[key] = srcVal;
    }
  }
  return target;
}
