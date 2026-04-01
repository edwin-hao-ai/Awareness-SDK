import { mcpResult } from './mcp-contract.mjs';
import {
  buildAgentPromptResult,
  buildInitResult,
  buildRecallResult,
} from './mcp-handlers.mjs';

export async function callMcpTool(daemon, name, args) {
  switch (name) {
    case 'awareness_init': {
      const initResult = buildInitResult({
        createSession: (source) => daemon._createSession(source),
        indexer: daemon.indexer,
        loadSpec: () => daemon._loadSpec(),
        source: args.source,
        days: args.days ?? 7,
        maxCards: args.max_cards ?? 5,
        maxTasks: args.max_tasks ?? 0,
        renderContextOptions: {
          localUrl: `http://localhost:${daemon.port}`,
          currentFocus: args.query,
        },
      });

      return mcpResult(initResult);
    }

    case 'awareness_recall': {
      return buildRecallResult({
        search: daemon.search,
        args,
      });
    }

    case 'awareness_record': {
      let result;
      switch (args.action) {
        case 'remember':
          result = await daemon._remember(args);
          break;
        case 'remember_batch':
          result = await daemon._rememberBatch(args);
          break;
        case 'update_task':
          result = await daemon._updateTask(args);
          break;
        case 'submit_insights':
          result = await daemon._submitInsights(args);
          break;
        default:
          result = { error: `Unknown action: ${args.action}` };
      }
      return mcpResult(result);
    }

    case 'awareness_lookup': {
      const result = await daemon._lookup(args);
      return mcpResult(result);
    }

    case 'awareness_get_agent_prompt': {
      return mcpResult(buildAgentPromptResult({
        loadSpec: () => daemon._loadSpec(),
        role: args.role,
      }));
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
