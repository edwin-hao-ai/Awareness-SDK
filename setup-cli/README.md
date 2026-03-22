# @awareness-sdk/setup

**One command to give your AI agent persistent memory. 13+ IDEs supported.**

```bash
npx @awareness-sdk/setup
```

Auto-detects your IDE, starts a local memory daemon, injects workflow rules, and configures MCP — all in one command. No account needed. Works offline.

---

## How It Works

```
npx @awareness-sdk/setup
    │
    ├── Detects IDE (Cursor? Claude Code? Windsurf? ...)
    ├── Starts local daemon (localhost:37800)
    ├── Writes workflow rules (teaches agent when to recall/record)
    ├── Writes MCP config (connects agent to memory daemon)
    └── Done ✅ — your agent now has persistent memory
```

## Modes

### Local Mode (Default)

```bash
npx @awareness-sdk/setup
```

- Starts a local daemon on `localhost:37800`
- Memories stored as Markdown files in `.awareness/`
- No account, no cloud, no API key needed
- Works offline

### Cloud Mode

```bash
npx @awareness-sdk/setup --cloud
```

- Opens browser for device-auth login
- Select or create a memory entity
- Enables cloud sync (semantic search, team collaboration, memory marketplace)
- Local daemon still runs — cloud is a sync layer, not a replacement

## Supported IDEs

| IDE | Rules File | MCP Config |
|-----|-----------|------------|
| **Cursor** | `.cursor/rules/awareness.mdc` | `.cursor/mcp.json` |
| **Claude Code** | `CLAUDE.md` | `.mcp.json` |
| **Windsurf** | `.windsurfrules` | `~/.codeium/windsurf/mcp_config.json` |
| **Cline** | `.clinerules` | UI-based (copy-paste) |
| **GitHub Copilot** | `.github/copilot-instructions.md` | `.vscode/mcp.json` |
| **Codex CLI** | `AGENTS.md` | `.codex/config.toml` |
| **Kiro** | `.kiro/steering/awareness.md` | `.kiro/settings/mcp.json` |
| **Trae** | `.trae/rules/awareness.md` | `.trae/mcp.json` |
| **Zed** | `.rules` | `~/.config/zed/settings.json` |
| **JetBrains (Junie)** | `.junie/guidelines.md` | `.junie/mcp/mcp.json` |
| **Augment** | `.augment/rules/awareness.md` | UI-based (copy-paste) |
| **AntiGravity (Jules)** | `.antigravity/rules.md` | `~/.gemini/antigravity/mcp_config.json` |
| **OpenClaw** | Plugin-based | `~/.openclaw/openclaw.json` |

## All Options

```
npx @awareness-sdk/setup                 Local mode (default)
npx @awareness-sdk/setup --cloud         Cloud mode (login + sync)
npx @awareness-sdk/setup --ide cursor    Force specific IDE
npx @awareness-sdk/setup --no-auth       Rules only, no MCP config
npx @awareness-sdk/setup --dry-run       Preview without writing
npx @awareness-sdk/setup --force         Overwrite managed files
npx @awareness-sdk/setup --list          Show supported IDEs
npx @awareness-sdk/setup --logout        Clear saved credentials
npx @awareness-sdk/setup --api-base <url>  Custom API URL
```

### Manual Cloud Config

```bash
npx @awareness-sdk/setup --mcp-url <url> --api-key <key> --memory-id <id>
```

## Non-Interactive Mode

When run without a TTY (e.g., from an AI agent via Bash), the CLI auto-selects all detected IDEs and defaults to English embedding model. No prompts.

## Embedding Language

During interactive setup, you can choose:

```
Search language:
  1. English only  (23 MB, faster)      ← default
  2. All languages (118 MB, 中文/日本語/한국어...)
```

## What It Writes

### Workflow Rules

Injected into your IDE's rules file (e.g., `CLAUDE.md`, `.cursor/rules/awareness.mdc`). Teaches your AI agent to:
- Call `awareness_init` at session start
- Call `awareness_recall` before making decisions
- Call `awareness_record` after every code change

### MCP Config

Connects your IDE to the memory daemon:

```json
{
  "mcpServers": {
    "awareness-memory": {
      "url": "http://localhost:37800/mcp"
    }
  }
}
```

## Related Packages

| Package | Description |
|---------|-------------|
| [`@awareness-sdk/local`](https://www.npmjs.com/package/@awareness-sdk/local) | Local daemon that this CLI starts |
| [`@awareness-sdk/memory-cloud`](https://www.npmjs.com/package/@awareness-sdk/memory-cloud) | TypeScript SDK with interceptors |
| [`awareness-memory-cloud`](https://pypi.org/project/awareness-memory-cloud/) | Python SDK with interceptors |
| [`@awareness-sdk/openclaw-memory`](https://www.npmjs.com/package/@awareness-sdk/openclaw-memory) | OpenClaw plugin |

## License

Apache 2.0
