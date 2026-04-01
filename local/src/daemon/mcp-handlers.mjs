import { buildContextXml } from '../harness-builder.mjs';
import {
  buildRecallFullContent,
  buildRecallNoQueryContent,
  buildRecallNoResultsContent,
  buildRecallSummaryContent,
} from './mcp-contract.mjs';
import {
  extractActiveSkills,
  splitPreferences,
  synthesizeRules,
} from './helpers.mjs';

export function buildInitResult({
  createSession,
  indexer,
  loadSpec,
  source,
  days = 7,
  maxCards = 5,
  maxTasks = 5,
  renderContextOptions = {},
}) {
  const session = createSession(source);
  const stats = indexer.getStats();
  const recentCards = indexer.getRecentKnowledge(maxCards);
  const allActiveCards = indexer.getRecentKnowledge(200);
  const openTasks = indexer.getOpenTasks(maxTasks);
  const rawSessions = indexer.getRecentSessions(days);

  let recentSessions = rawSessions.filter((sessionItem) => sessionItem.memory_count > 0 || sessionItem.summary);
  if (recentSessions.length === 0) {
    recentSessions = rawSessions.slice(0, 3);
  }
  recentSessions = recentSessions.slice(0, 5);

  const spec = loadSpec();
  const now = Date.now();
  const staleDays = 3;
  const staleCutoff = now - staleDays * 86400000;
  const staleTasks = openTasks.filter((task) => {
    const created = task.created_at ? new Date(task.created_at).getTime() : now;
    return created < staleCutoff;
  }).length;
  const riskCards = indexer.db
    .prepare("SELECT COUNT(*) as cnt FROM knowledge_cards WHERE (category = 'risk' OR category = 'pitfall') AND status = 'active'")
    .get();
  const highRisks = riskCards?.cnt || 0;

  const attentionSummary = {
    stale_tasks: staleTasks,
    high_risks: highRisks,
    total_open_tasks: openTasks.length,
    total_knowledge_cards: recentCards.length,
    needs_attention: staleTasks > 0 || highRisks > 0,
  };

  const { rules, rule_count } = synthesizeRules(allActiveCards);
  const activeSkills = extractActiveSkills(allActiveCards);
  const { user_preferences, knowledge_cards: otherCards } = splitPreferences(recentCards);

  const initResult = {
    session_id: session.id,
    mode: 'local',
    user_preferences,
    knowledge_cards: otherCards,
    open_tasks: openTasks,
    recent_sessions: recentSessions,
    stats,
    attention_summary: attentionSummary,
    synthesized_rules: { rules, rule_count },
    init_guides: spec.init_guides || {},
    agent_profiles: [],
    active_skills: activeSkills,
    setup_hints: [],
  };

  try {
    initResult.rendered_context = buildContextXml(initResult, [], [], renderContextOptions);
  } catch {
    // Non-fatal — client can still use structured data
  }

  return initResult;
}

export async function buildRecallResult({ search, args, mode = 'local' }) {
  if (args.detail === 'full' && args.ids?.length) {
    const items = search
      ? await search.getFullContent(args.ids)
      : [];
    return buildRecallFullContent(items);
  }

  if (!args.semantic_query && !args.keyword_query) {
    return buildRecallNoQueryContent();
  }

  const summaries = search
    ? await search.recall(args)
    : [];

  if (!summaries.length) {
    return buildRecallNoResultsContent();
  }

  return buildRecallSummaryContent(summaries, mode);
}

export function buildAgentPromptResult({ loadSpec, role }) {
  const spec = loadSpec();
  return {
    prompt: spec.init_guides?.sub_agent_guide || '',
    role: role || '',
    mode: 'local',
  };
}
