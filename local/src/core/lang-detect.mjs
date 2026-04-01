/**
 * Language detection utilities for Awareness Local.
 *
 * Shared by daemon.mjs and search.mjs to avoid logic drift.
 */

/**
 * Detect if text needs a CJK-aware multilingual embedding model.
 * Samples the first 500 chars; if CJK characters exceed 5% of non-space
 * characters, returns true.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function detectNeedsCJK(text) {
  if (!text) return false;
  const sample = text.slice(0, 500);
  const cjkChars = sample.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\u3400-\u4dbf]/g);
  if (!cjkChars) return false;
  const nonSpace = sample.replace(/\s/g, '').length;
  return nonSpace > 0 && (cjkChars.length / nonSpace) > 0.05;
}
