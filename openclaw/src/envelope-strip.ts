/**
 * F-055 bug B — plugin-side metadata envelope stripper.
 *
 * OpenClaw wraps each agent turn in metadata envelopes that must be removed
 * before the message is written to memory. Returns an empty string when the
 * input collapses to envelope-only noise, so the caller can skip recording.
 *
 * Pure function, no external dependencies. The daemon also filters envelopes
 * (sdks/local/src/core/noise-filter.mjs) as defense-in-depth; this stripper
 * runs at the earliest point — before the `Request: ...` turn_brief is even
 * constructed — so titles stay clean.
 */

const MAX_OUTPUT_CHARS = 2000;

const ENVELOPE_BLOCK_PATTERNS: RegExp[] = [
  /^\s*Sender\s*\(untrusted metadata\)\s*:[^\n]*(?:\n(?!\n)[^\n]*)*(?:\n\n|\n?$)/i,
  /^\s*\[Operational context metadata[^\]]*\][^\n]*(?:\n(?!\n)[^\n]*)*(?:\n\n|\n?$)/i,
  /^\s*\[Subagent Context\][^\n]*(?:\n(?!\n)[^\n]*)*(?:\n\n|\n?$)/i,
];

const LINE_PREFIX_PATTERN = /^\s*(?:Request|Result|Send)\s*:\s*/i;

export function stripMetadataEnvelope(input: unknown): string {
  if (typeof input !== "string") return "";

  let text = input.slice(0, 200_000);

  for (let i = 0; i < 5; i++) {
    let matched = false;
    for (const pattern of ENVELOPE_BLOCK_PATTERNS) {
      const next = text.replace(pattern, "");
      if (next !== text) {
        text = next;
        matched = true;
      }
    }
    const stripped = text.replace(LINE_PREFIX_PATTERN, "");
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
