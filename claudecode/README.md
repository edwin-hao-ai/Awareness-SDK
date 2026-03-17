# @awareness/claudecode-memory

Claude Code plugin for persistent cross-session memory via [Awareness Memory Cloud](https://awareness.market).

Gives Claude Code a long-term memory that survives across sessions — no more forgetting what was built, repeating architectural decisions, or losing track of open TODOs.

Online docs: <https://awareness.market/docs?doc=ide-plugins>

## Quick Start

### 1. Install the plugin

```bash
# Once published to marketplace
claude plugin install awareness-memory

# Or from the Awareness repo root (local dev)
claude plugin install -l ./claudecode
```

### 2. One-command setup (recommended)

After installing, just run:

```
/awareness-memory:setup
```

This will:
- Open your browser to sign in (or create an account)
- Let you select (or create) a memory
- Automatically write your credentials to settings.json

After setup completes, restart Claude Code and you're ready to go.

### 3. Manual configuration (alternative)

If you prefer to configure manually, edit `~/.claude/plugins/awareness-memory/settings.json`:

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

### 4. Verify

```bash
# Check MCP server is connected
claude /mcp
# Should show: awareness-memory ✓

# Load memory context
/awareness-memory:session-start
```

---

## Available Skills

| Skill | Command | When to Use |
|-------|---------|-------------|
| `setup` | `/awareness-memory:setup` | First time — authenticate via browser and configure credentials |
| `session-start` | `/awareness-memory:session-start` | Start of every session — loads recent progress, open tasks, relevant context |
| `recall` | `/awareness-memory:recall <query>` | Before implementing anything — check if it already exists |
| `save` | `/awareness-memory:save` | After completing a step or before ending a session |
| `done` | `/awareness-memory:done` | Close the session with a final summary and handoff |

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
| `__awareness_workflow__` | Workflow checklist — call when unsure what to do next |
| `awareness_init` | Initialize session + load cross-session context (narratives, tasks, knowledge cards) |
| `awareness_recall` | Semantic + keyword hybrid search across all stored memories |
| `awareness_lookup` | Structured data retrieval: context, tasks, knowledge, risks, timeline, rules, graph, agents |
| `awareness_record` | All writes: remember, remember\_batch, backfill, ingest, update\_task, submit\_insights |

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

**"Not configured yet" message on session start**
- Run `/awareness-memory:setup` to authenticate and configure in one step
- Or manually edit `settings.json` with your API key and memory ID

**MCP server not appearing in `/mcp`**
- Make sure you restarted Claude Code after running `/awareness-memory:setup`
- Check that `AWARENESS_MCP_URL` is reachable
- Verify `AWARENESS_API_KEY` is valid (starts with `aw_`)
- Run `claude plugin list` to confirm the plugin is installed

**Setup browser not opening**
- The `/awareness-memory:setup` skill will show you a URL to open manually
- Make sure you complete authorization within 10 minutes

**Skills returning empty results**
- Ensure `AWARENESS_MEMORY_ID` points to a memory with data
- Visit the Awareness Dashboard → Data tab to verify stored memories

**Local deployment**
- Set `AWARENESS_MCP_URL` to `http://localhost:8001/mcp`
- Ensure you have a valid API key from [https://awareness.market/dashboard](https://awareness.market/dashboard)

---

## License

Apache-2.0
