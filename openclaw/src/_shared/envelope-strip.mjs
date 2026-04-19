// ⚠️  DO NOT EDIT — synced from sdks/_shared/js/envelope-strip.mjs
// Edit the SSOT and run `node scripts/sync-shared-js.mjs`.
/**
 * Metadata envelope stripper. Pure, no deps.
 *
 * Removes OpenClaw-style wrappers (Sender/Operational context/Subagent Context)
 * and per-line Request:/Result:/Send: prefixes from raw agent turn text.
 * Returns empty string when the input collapses to envelope-only noise.
 *
 * SSOT: sdks/_shared/js/envelope-strip.mjs
 * Sync: scripts/sync-shared-js.mjs distributes to each SDK's src/_shared/.
 */

const MAX_OUTPUT_CHARS = 2000;

const ENVELOPE_BLOCK_PATTERNS = [
  /^\s*Sender\s*\(untrusted metadata\)\s*:[^\n]*(?:\n(?!\n)[^\n]*)*(?:\n\n|\n?$)/i,
  /^\s*\[Operational context metadata[^\]]*\][^\n]*(?:\n(?!\n)[^\n]*)*(?:\n\n|\n?$)/i,
  /^\s*\[Subagent Context\][^\n]*(?:\n(?!\n)[^\n]*)*(?:\n\n|\n?$)/i,
];

const LINE_PREFIX_PATTERN = /^\s*(?:Request|Result|Send)\s*:\s*/i;

/**
 * @param {unknown} input
 * @returns {string} trimmed text with envelopes stripped, or '' if nothing survives.
 */
export function stripMetadataEnvelope(input) {
  if (typeof input !== 'string') return '';

  let text = input.slice(0, 200_000);

  for (let i = 0; i < 5; i++) {
    let matched = false;
    for (const pattern of ENVELOPE_BLOCK_PATTERNS) {
      const next = text.replace(pattern, '');
      if (next !== text) {
        text = next;
        matched = true;
      }
    }
    const stripped = text.replace(LINE_PREFIX_PATTERN, '');
    if (stripped !== text) {
      text = stripped;
      matched = true;
    }
    if (!matched) break;
  }

  const trimmed = text.trim();
  if (trimmed.length > MAX_OUTPUT_CHARS) {
    return trimmed.slice(0, MAX_OUTPUT_CHARS);
  }
  return trimmed;
}
