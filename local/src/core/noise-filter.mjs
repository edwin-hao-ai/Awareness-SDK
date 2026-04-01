/**
 * Minimal local write-noise filter.
 *
 * This intentionally stays conservative and language-agnostic:
 * - block structurally low-value events
 * - preserve titled records and structured insights
 * - avoid language-specific keyword lists so the filter works across many languages
 */

const MIN_CONTENT_CHARS = 20;
const MIN_MEANINGFUL_CHARS = 8;
const MAX_TERSE_TOKEN_COUNT = 2;
const MAX_TERSE_CHAR_COUNT = 12;

function stripMarkdownPrefix(content) {
  return String(content || '')
    .replace(/^\*\*\w+\*\*\s*\w*\s*\n*/u, '')
    .trim();
}

function countMeaningfulChars(content) {
  const matches = String(content || '').match(/[\p{L}\p{N}]/gu);
  return matches ? matches.length : 0;
}

function countTokens(content) {
  return String(content || '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .length;
}

export function classifyNoiseEvent(params = {}) {
  const eventType = String(params.event_type || '').trim();
  const title = String(params.title || '').trim();
  const content = String(params.content || '');
  const cleaned = stripMarkdownPrefix(content);
  const insights = params.insights || null;
  const hasStructuredInsights = Boolean(
    insights?.knowledge_cards?.length ||
    insights?.action_items?.length ||
    insights?.risks?.length ||
    insights?.completed_tasks?.length
  );

  if (eventType === 'session_checkpoint') {
    return 'session_checkpoint filtered';
  }

  if (!cleaned) {
    return 'empty_content filtered';
  }

  if (!title && !hasStructuredInsights) {
    const meaningfulChars = countMeaningfulChars(cleaned);
    const tokenCount = countTokens(cleaned);

    if (meaningfulChars < MIN_MEANINGFUL_CHARS) {
      return 'low_signal_noise filtered';
    }

    if (tokenCount <= MAX_TERSE_TOKEN_COUNT && cleaned.length <= MAX_TERSE_CHAR_COUNT) {
      return 'terse_noise filtered';
    }

    if (cleaned.length < MIN_CONTENT_CHARS) {
      return 'short_noise filtered';
    }
  }

  return null;
}

export function shouldStoreMemoryEvent(params = {}) {
  return classifyNoiseEvent(params) === null;
}
