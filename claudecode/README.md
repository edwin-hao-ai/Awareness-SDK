# @awareness/claudecode-memory

Claude Code plugin for persistent cross-session memory via [Awareness Memory Cloud](https://awareness.market).

Gives Claude Code a long-term memory that survives across sessions — no more forgetting what was built, repeating architectural decisions, or losing track of open TODOs.

## Quick Start

### 1. Install the plugin

```bash
# From the Awareness repo root
claude plugin install -l ./sdks/claudecode

# Once published to marketplace
claude plugin install awareness-memory
```

### 2. Configure

Edit `sdks/claudecode/settings.json` (or `~/.claude/plugins/awareness-memory/settings.json` after install):

```json
{
  "env": {
    "AWARENESS_MCP_URL": "https://awareness.market/mcp",
    "AWARENESS_MEMORY_ID": "your-memory-id",
    "AWARENESS_API_KEY": "aw_your-api-key",
    "AWARENESS_AGENT_ROLE": "builder_agent"
  }
}
```

Get your `AWARENESS_API_KEY` and `AWARENESS_MEMORY_ID` from the [Awareness Dashboard](https://awareness.market/dashboard) → Connect tab.

For local self-hosted deployments, set `AWARENESS_MCP_URL` to `http://localhost:8001/mcp`.

### 3. Verify

```bash
# Check MCP server is connected
claude /mcp
# Should show: awareness-memory ✓

# Load memory context
/awareness-memory:session-start

# Check open tasks
/awareness-memory:tasks
```

---

## Available Skills

| Skill | Command | When to Use |
|-------|---------|-------------|
| `session-start` | `/awareness-memory:session-start` | Start of every session — loads recent progress, open tasks, relevant context |
| `recall` | `/awareness-memory:recall <query>` | Before implementing anything — check if it already exists |
| `save` | `/awareness-memory:save` | After completing a step or before ending a session |
| `tasks` | `/awareness-memory:tasks` | Resume work — see what was left incomplete |

---

## Recommended Workflow

```
Session starts
  └─ /awareness-memory:session-start      ← load context

Before new feature
  └─ /awareness-memory:recall "feature name"  ← check existing work

During development (every 5-8 steps)
  └─ Claude auto-saves via remember_step

Before ending session
  └─ /awareness-memory:save               ← persist progress

Next session
  └─ /awareness-memory:session-start      ← full context restored
```

---

## MCP Tools Available

Once connected, Claude Code has access to these Awareness MCP tools:

| Tool | Description |
|------|-------------|
| `recall_for_task` | Semantic search across all stored memories |
| `get_session_context` | Full project state: narratives, tasks, knowledge cards |
| `remember_step` | Save a single step (what changed and why) |
| `remember_batch` | Batch save multiple steps at once |
| `get_knowledge_base` | Query 13-category structured knowledge cards |
| `get_pending_tasks` | Retrieve pending and in-progress action items |
| `supersede_knowledge_card` | Mark an outdated knowledge card as superseded |

---

## Configuration Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `AWARENESS_MCP_URL` | Awareness MCP server URL | `https://awareness.market/mcp` |
| `AWARENESS_MEMORY_ID` | Target memory instance UUID | *(required)* |
| `AWARENESS_API_KEY` | Awareness API key (`aw_` prefix) | *(required)* |
| `AWARENESS_AGENT_ROLE` | Agent role for scoped recall | `builder_agent` |

---

## Troubleshooting

**MCP server not appearing in `/mcp`**
- Check that `AWARENESS_MCP_URL` is reachable
- Verify `AWARENESS_API_KEY` is valid (starts with `aw_`)
- Run `claude plugin list` to confirm the plugin is installed

**Skills returning empty results**
- Ensure `AWARENESS_MEMORY_ID` points to a memory with data
- Visit the Awareness Dashboard → Data tab to verify stored memories

**Local deployment**
- Set `AWARENESS_MCP_URL` to `http://localhost:8001/mcp`
- Ensure you have a valid API key from [https://awareness.market/dashboard](https://awareness.market/dashboard)

---

## License

Apache-2.0
