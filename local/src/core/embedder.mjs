/**
 * Embedder — local embedding module for Awareness Local.
 *
 * Uses @huggingface/transformers (ONNX WASM) for purely-in-JS inference.
 * Falls back gracefully to FTS5-only mode when the dependency is missing.
 *
 * Two model options (user-facing names hide actual model identifiers):
 *   "english"       → Xenova/all-MiniLM-L6-v2       (23 MB, English only)
 *   "multilingual"  → Xenova/multilingual-e5-small   (118 MB, 100+ languages)
 *
 * Both produce 384-dimensional Float32Array vectors.
 */

// ---------------------------------------------------------------------------
// Model map
// ---------------------------------------------------------------------------

export const MODEL_MAP = {
  english: 'Xenova/all-MiniLM-L6-v2',
  multilingual: 'Xenova/multilingual-e5-small',
};

/**
 * Models whose architecture requires a "query: " / "passage: " prefix.
 * Currently only the e5 family needs this.
 */
const E5_MODELS = new Set([MODEL_MAP.multilingual]);

// ---------------------------------------------------------------------------
// Pipeline cache (one per language/model)
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<any>>} */
const _pipelineCache = new Map();

/** Whether the HF transformers library is available at all. */
let _hfAvailable = null; // null = not checked yet, true/false after first probe

/**
 * Dynamically import @huggingface/transformers.
 * Returns the module or null if not installed.
 * @private
 */
async function _loadHfModule() {
  if (_hfAvailable === false) return null;
  try {
    const mod = await import('@huggingface/transformers');
    _hfAvailable = true;
    return mod;
  } catch {
    _hfAvailable = false;
    console.warn(
      '[embedder] @huggingface/transformers is not installed. ' +
        'Embedding-based semantic search is disabled; falling back to FTS5-only mode. ' +
        'Install it with: npm install @huggingface/transformers'
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lazy-load (and cache) the embedding pipeline for the given language.
 *
 * @param {string} [language='english'] — 'english' | 'multilingual'
 * @returns {Promise<Function|null>} — the HF pipeline function, or null if unavailable.
 */
export async function getEmbedder(language = 'english') {
  const modelId = MODEL_MAP[language] || MODEL_MAP.english;

  if (_pipelineCache.has(modelId)) {
    return _pipelineCache.get(modelId);
  }

  // Store the promise itself so concurrent callers share the same load.
  const loadPromise = (async () => {
    const hf = await _loadHfModule();
    if (!hf) return null;

    const pipe = await hf.pipeline('feature-extraction', modelId, {
      dtype: 'q8', // INT8 quantised
    });
    return pipe;
  })();

  _pipelineCache.set(modelId, loadPromise);

  // If the load fails, evict the cache entry so the next call can retry.
  loadPromise.catch(() => {
    _pipelineCache.delete(modelId);
  });

  return loadPromise;
}

/**
 * Check whether embedding is available (HF library installed).
 *
 * @returns {Promise<boolean>}
 */
export async function isEmbeddingAvailable() {
  if (_hfAvailable !== null) return _hfAvailable;
  const mod = await _loadHfModule();
  return mod !== null;
}

/**
 * Embed a single text string.
 *
 * @param {string} text
 * @param {string} [type='passage'] — 'query' | 'passage' (affects e5 prefix).
 * @param {string} [language='english'] — 'english' | 'multilingual'.
 * @returns {Promise<Float32Array>} — 384-dimensional normalised vector.
 * @throws {Error} if embedding is unavailable.
 */
export async function embed(text, type = 'passage', language = 'english') {
  const pipe = await getEmbedder(language);
  if (!pipe) {
    throw new Error(
      'Embedding unavailable: @huggingface/transformers is not installed.'
    );
  }

  const modelId = MODEL_MAP[language] || MODEL_MAP.english;
  const input = E5_MODELS.has(modelId) ? `${type}: ${text}` : text;

  const output = await pipe(input, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data);
}

/**
 * Embed multiple texts in a single batch call.
 *
 * @param {string[]} texts
 * @param {string} [type='passage']
 * @param {string} [language='english']
 * @returns {Promise<Float32Array[]>}
 * @throws {Error} if embedding is unavailable.
 */
export async function embedBatch(texts, type = 'passage', language = 'english') {
  if (!texts || texts.length === 0) return [];

  const pipe = await getEmbedder(language);
  if (!pipe) {
    throw new Error(
      'Embedding unavailable: @huggingface/transformers is not installed.'
    );
  }

  const modelId = MODEL_MAP[language] || MODEL_MAP.english;
  const usePrefix = E5_MODELS.has(modelId);

  const inputs = usePrefix ? texts.map((t) => `${type}: ${t}`) : texts;

  const output = await pipe(inputs, { pooling: 'mean', normalize: true });

  // The pipeline returns a nested tensor; output.tolist() gives number[][].
  // We convert each sub-array to a Float32Array.
  const dim = 384;
  const results = [];
  if (output.data && output.data.length === texts.length * dim) {
    // Flat buffer — slice into per-text vectors.
    for (let i = 0; i < texts.length; i++) {
      results.push(new Float32Array(output.data.slice(i * dim, (i + 1) * dim)));
    }
  } else if (typeof output.tolist === 'function') {
    const nested = output.tolist();
    for (const row of nested) {
      results.push(new Float32Array(row));
    }
  } else {
    // Fallback: embed one-by-one.
    for (const text of texts) {
      results.push(await embed(text, type, language));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Vector utilities
// ---------------------------------------------------------------------------

/**
 * Cosine similarity between two vectors.
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} — value in [-1, 1].
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Convert a Float32Array to a Buffer suitable for SQLite BLOB storage.
 *
 * @param {Float32Array} vector
 * @returns {Buffer}
 */
export function vectorToBuffer(vector) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * Convert a Buffer (from SQLite BLOB) back to a Float32Array.
 *
 * @param {Buffer} buffer
 * @returns {Float32Array}
 */
export function bufferToVector(buffer) {
  return new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
}
