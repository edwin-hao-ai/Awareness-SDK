/**
 * Extraction Orchestrator — F-031 Phase 1 Task 4.5
 *
 * Handles multi-pass extraction for schema_version >= 2:
 *   Pass 1: Extract atomic claims from events (bullet list)
 *   Pass 2: Synthesize claims into structured knowledge cards
 *
 * The orchestrator receives an extraction_request from the backend
 * (containing a `passes` array) and executes each pass sequentially,
 * feeding the output of Pass 1 into the input of Pass 2.
 *
 * LLM inference is delegated to the configured endpoint (local Ollama,
 * Claude API, or any OpenAI-compatible endpoint).
 */

const LOG_PREFIX = '[extraction-orchestrator]';

/**
 * Execute a multi-pass extraction pipeline.
 *
 * @param {Object} extractionRequest - The extraction_request from backend
 * @param {Object} options
 * @param {Function} options.llmInfer - async (systemPrompt, userContent) => string
 * @param {Function} [options.onPassComplete] - callback(passNumber, output)
 * @param {number} [options.timeoutMs=30000] - per-pass timeout
 * @returns {Object} Structured extraction result (knowledge_cards, risks, etc.)
 */
export async function executeMultiPassExtraction(extractionRequest, options = {}) {
  const { llmInfer, onPassComplete, timeoutMs = 30000 } = options;

  if (!llmInfer) {
    throw new Error(`${LOG_PREFIX} llmInfer function is required`);
  }

  const schemaVersion = extractionRequest.schema_version || 1;
  const passes = extractionRequest.passes;

  // v1: single-pass — delegate directly to LLM
  if (schemaVersion < 2 || !Array.isArray(passes) || passes.length === 0) {
    return executeSinglePass(extractionRequest, { llmInfer, timeoutMs });
  }

  // v2: multi-pass pipeline
  const pass1 = passes.find(p => p.pass === 1);
  const pass2 = passes.find(p => p.pass === 2);

  if (!pass1 || !pass2) {
    console.warn(`${LOG_PREFIX} v2 extraction missing pass1 or pass2, falling back to single-pass`);
    return executeSinglePass(extractionRequest, { llmInfer, timeoutMs });
  }

  // --- Pass 1: Extract atomic claims ---
  const eventsText = formatEventsForLLM(pass1.events || []);
  let claimsBulletList;
  try {
    claimsBulletList = await withTimeout(
      llmInfer(pass1.system_prompt, eventsText),
      timeoutMs,
      'Pass 1 timed out',
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} Pass 1 failed:`, err.message);
    // Fallback: use events directly as claims
    claimsBulletList = eventsText;
  }

  if (onPassComplete) onPassComplete(1, claimsBulletList);

  // --- Pass 2: Synthesize cards from claims ---
  const pass2Prompt = injectPlaceholders(pass2.system_prompt, {
    existing_cards: formatExistingCards(pass2.existing_cards || []),
    existing_tasks: formatExistingTasks(pass2.existing_tasks || []),
  });

  const pass2Input = `## CLAIMS (from Pass 1):\n${claimsBulletList}\n\n## ORIGINAL EVENTS (for context):\n${eventsText}`;

  let rawResult;
  try {
    rawResult = await withTimeout(
      llmInfer(pass2Prompt, pass2Input),
      timeoutMs,
      'Pass 2 timed out',
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} Pass 2 failed:`, err.message);
    return { knowledge_cards: [], risks: [], action_items: [], completed_tasks: [], turn_brief: '', entities: [], relations: [] };
  }

  if (onPassComplete) onPassComplete(2, rawResult);

  // Parse JSON from LLM output
  return parseExtractionResult(rawResult);
}


/**
 * Execute a v1 single-pass extraction.
 */
async function executeSinglePass(request, { llmInfer, timeoutMs }) {
  const prompt = injectPlaceholders(request.system_prompt || '', {
    existing_cards: formatExistingCards(request.existing_cards || []),
    existing_tasks: formatExistingTasks(request.existing_tasks || []),
  });

  const eventsText = formatEventsForLLM(request.events || []);

  try {
    const rawResult = await withTimeout(
      llmInfer(prompt, eventsText),
      timeoutMs,
      'Single-pass extraction timed out',
    );
    return parseExtractionResult(rawResult);
  } catch (err) {
    console.error(`${LOG_PREFIX} Single-pass extraction failed:`, err.message);
    return { knowledge_cards: [], risks: [], action_items: [], completed_tasks: [], turn_brief: '', entities: [], relations: [] };
  }
}


/**
 * Format events array into a readable text block for LLM input.
 */
function formatEventsForLLM(events) {
  return events
    .map((e, i) => `[${i + 1}] (${e.event_type || 'unknown'}, ${e.source || 'unknown'}) ${e.content || ''}`)
    .join('\n\n');
}


/**
 * Format existing cards for injection into prompt placeholders.
 */
function formatExistingCards(cards) {
  if (!cards || cards.length === 0) return '[]';
  return JSON.stringify(
    cards.map(c => ({
      id: c.id,
      title: c.title || '',
      summary: (c.summary || '').slice(0, 300),
      category: c.category || '',
    })),
    null,
    2,
  );
}


/**
 * Format existing tasks for injection into prompt placeholders.
 */
function formatExistingTasks(tasks) {
  if (!tasks || tasks.length === 0) return '[]';
  return JSON.stringify(
    tasks.map(t => ({
      id: t.id,
      title: t.title || '',
      status: t.status || '',
      priority: t.priority || '',
    })),
    null,
    2,
  );
}


/**
 * Replace {placeholder} tokens in a prompt string.
 */
function injectPlaceholders(prompt, replacements) {
  let result = prompt;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}


/**
 * Parse JSON from LLM output, handling markdown code fences.
 */
function parseExtractionResult(raw) {
  const empty = { knowledge_cards: [], risks: [], action_items: [], completed_tasks: [], turn_brief: '', entities: [], relations: [] };
  if (!raw || typeof raw !== 'string') return empty;

  // Strip markdown code fences
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      knowledge_cards: Array.isArray(parsed.knowledge_cards) ? parsed.knowledge_cards : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
      action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
      completed_tasks: Array.isArray(parsed.completed_tasks) ? parsed.completed_tasks : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities : [],
      relations: Array.isArray(parsed.relations) ? parsed.relations : [],
      turn_brief: parsed.turn_brief || '',
    };
  } catch (err) {
    console.warn(`${LOG_PREFIX} failed to parse extraction JSON:`, err.message);
    return empty;
  }
}


/**
 * Timeout wrapper for async operations.
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} (${ms}ms)`)), ms);
    promise
      .then(val => { clearTimeout(timer); resolve(val); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}
