/**
 * sync.ts — Bidirectional sync between Awareness memory and OpenClaw Markdown files.
 *
 * OpenClaw's native memory is plain Markdown:
 *   MEMORY.md           — long-term curated knowledge (decisions, preferences, facts)
 *   memory/YYYY-MM-DD.md — daily logs (append-only)
 *
 * This module:
 *   1. Write-back: After every Awareness record, mirror to OpenClaw md files
 *   2. Import:     On first install, import existing OpenClaw md → Awareness
 */

import * as fs from "fs";
import * as path from "path";
import type { AwarenessClient } from "./client";
import type { PluginLogger } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIGRATION_MARKER = ".awareness-openclaw-imported";
const MAX_MEMORY_MD_ENTRY_CHARS = 1200; // MEMORY.md summary per card (keep concise but complete)
const MAX_DAILY_ENTRY_CHARS = 3000;     // Daily log entry (allow full session capture content)
const MAX_IMPORT_DAILY_BLOCK_CHARS = 3000; // Per block when importing daily logs
const MAX_IMPORT_SESSION_MSG_CHARS = 800;  // Per message when importing session JSONL
const MAX_IMPORT_SESSIONS = 20;
const MAX_IMPORT_MESSAGES_PER_SESSION = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve OpenClaw workspace directory. */
function resolveWorkspace(): string | null {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const candidates = [
    process.env.OPENCLAW_WORKSPACE,
    path.join(home, ".openclaw", "workspace"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/** Get today's date as YYYY-MM-DD. */
function todayDate(): string {
  return new Date().toISOString().split("T")[0];
}

/** Get current time as HH:MM. */
function nowTime(): string {
  return new Date().toTimeString().slice(0, 5);
}

/** Safely append text to a file (creates parent dirs if needed). */
function appendToFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, content, "utf8");
}

/** Read file content or return empty string. */
function readFileOr(filePath: string, fallback = ""): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Write-back: Awareness → OpenClaw Markdown
// ---------------------------------------------------------------------------

/**
 * Append a daily log entry to memory/YYYY-MM-DD.md.
 * Called after auto-capture or manual awareness_record.
 */
export function syncDailyLog(content: string, source = "awareness"): void {
  const workspace = resolveWorkspace();
  if (!workspace) return;
  try {
    const date = todayDate();
    const time = nowTime();
    const filePath = path.join(workspace, "memory", `${date}.md`);
    const truncated = content.slice(0, MAX_DAILY_ENTRY_CHARS);
    const entry = `\n### ${time} — [${source}]\n\n${truncated}\n\n---\n`;
    appendToFile(filePath, entry);
  } catch {
    // Best-effort — never block the main flow
  }
}

/**
 * Append a knowledge card to MEMORY.md.
 * Called when insights contain knowledge_cards.
 */
export function syncKnowledgeCard(
  card: { category?: string; title?: string; summary?: string; tags?: string[] },
): void {
  const workspace = resolveWorkspace();
  if (!workspace) return;
  try {
    const memoryMd = path.join(workspace, "MEMORY.md");
    const existing = readFileOr(memoryMd);

    // Deduplicate: skip if title already exists in MEMORY.md
    const title = card.title ?? "";
    if (title && existing.includes(title)) return;

    const category = card.category ?? "insight";
    const summary = (card.summary ?? "").slice(0, MAX_MEMORY_MD_ENTRY_CHARS);
    const tags = Array.isArray(card.tags) && card.tags.length > 0
      ? `\n_Tags: ${card.tags.join(", ")} | ${todayDate()}_`
      : `\n_${todayDate()}_`;
    const entry = `\n[${category}] **${title}**: ${summary}${tags}\n`;

    appendToFile(memoryMd, entry);
  } catch {
    // Best-effort
  }
}

/**
 * Sync a full record result to OpenClaw md files.
 * Called from tools.ts and hooks.ts after a successful record.
 */
export function syncRecordToOpenClaw(
  content: string,
  insights?: Record<string, unknown>,
  source = "awareness",
): void {
  // 1. Always write daily log
  syncDailyLog(content, source);

  // 2. If insights contain knowledge cards, also write to MEMORY.md
  if (insights) {
    const cards = (insights as Record<string, unknown>).knowledge_cards;
    if (Array.isArray(cards)) {
      // Standard format: {knowledge_cards: [{category, title, summary, tags}]}
      for (const card of cards) {
        if (card && typeof card === "object") {
          syncKnowledgeCard(card as { category?: string; title?: string; summary?: string; tags?: string[] });
        }
      }
    } else if (insights.category || insights.title || insights.decision) {
      // Flat format from LLMs that don't follow the nested schema:
      // {category: "architecture", decision: "PostgreSQL over MongoDB", rationale: [...]}
      const title = String(insights.title ?? insights.decision ?? "");
      const summary = insights.rationale
        ? (Array.isArray(insights.rationale) ? (insights.rationale as string[]).join("; ") : String(insights.rationale))
        : content.slice(0, MAX_MEMORY_MD_ENTRY_CHARS);
      if (title) {
        syncKnowledgeCard({
          category: String(insights.category ?? "insight"),
          title,
          summary,
          tags: Array.isArray(insights.tags) ? insights.tags as string[] : undefined,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Import: OpenClaw Markdown → Awareness
// ---------------------------------------------------------------------------

/** Check if import has already been done. */
function isImported(workspace: string): boolean {
  return fs.existsSync(path.join(workspace, MIGRATION_MARKER));
}

/** Mark import as done. */
function markImported(workspace: string): void {
  try {
    fs.writeFileSync(
      path.join(workspace, MIGRATION_MARKER),
      `Imported at ${new Date().toISOString()}\n`,
      "utf8",
    );
  } catch {
    // Best-effort
  }
}

/**
 * Parse MEMORY.md into individual entries.
 * Supports formats like:
 *   [category] **Title**: Summary
 *   [category] Title: Summary
 *   Free-form paragraphs separated by blank lines
 */
function parseMemoryMd(content: string): Array<{ text: string; category?: string }> {
  const entries: Array<{ text: string; category?: string }> = [];
  if (!content.trim()) return entries;

  // Split by blank lines or "---" separators
  const blocks = content.split(/\n(?:\s*\n|\s*---\s*\n)/).filter((b) => b.trim().length > 20);
  for (const block of blocks) {
    const trimmed = block.trim();
    // Try to extract [category] prefix
    const match = trimmed.match(/^\[(\w+)\]\s*(.*)/s);
    if (match) {
      entries.push({ text: match[2].trim(), category: match[1] });
    } else {
      entries.push({ text: trimmed });
    }
  }
  return entries;
}

/**
 * Parse memory/YYYY-MM-DD.md daily logs into entries.
 */
function parseDailyMd(content: string, date: string): Array<{ text: string; date: string }> {
  const entries: Array<{ text: string; date: string }> = [];
  if (!content.trim()) return entries;

  // Split by ### headings or --- separators
  const blocks = content.split(/(?=^### |\n---\n)/m).filter((b) => b.trim().length > 20);
  for (const block of blocks) {
    entries.push({ text: block.trim().slice(0, MAX_IMPORT_DAILY_BLOCK_CHARS), date });
  }
  return entries;
}

/**
 * Parse a session JSONL file into a summary string.
 */
function parseSessionJsonl(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const messages: Array<{ role: string; text: string }> = [];

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== "message") continue;
        const msg = obj.message;
        if (!msg || !msg.role) continue;
        const role = msg.role;
        if (role !== "user" && role !== "assistant") continue;

        // Extract text content
        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((c: Record<string, unknown>) => c.type === "text")
            .map((c: Record<string, unknown>) => c.text)
            .join("\n");
        }
        if (!text || text.startsWith("/")) continue; // Skip commands

        // Remove awareness-memory XML blocks
        text = text.replace(/<awareness-memory>[\s\S]*?<\/awareness-memory>/g, "").trim();
        if (text.length < 10) continue;

        messages.push({ role, text: text.slice(0, MAX_IMPORT_SESSION_MSG_CHARS) });
      } catch {
        // Skip malformed lines
      }
    }

    if (messages.length === 0) return null;

    // Take last N messages for summary
    const recent = messages.slice(-MAX_IMPORT_MESSAGES_PER_SESSION);
    const parts: string[] = [];
    for (const m of recent) {
      parts.push(`${m.role}: ${m.text}`);
    }
    return parts.join("\n\n");
  } catch {
    return null;
  }
}

/**
 * Import existing OpenClaw memory into Awareness.
 * Runs once on first plugin install. Idempotent via marker file.
 */
export async function importOpenClawHistory(
  client: AwarenessClient,
  logger: PluginLogger,
): Promise<{ imported: number; skipped: number }> {
  const workspace = resolveWorkspace();
  if (!workspace) {
    return { imported: 0, skipped: 0 };
  }

  if (isImported(workspace)) {
    return { imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped = 0;

  try {
    const batchItems: string[] = [];

    // 1. Import MEMORY.md
    const memoryMdPath = path.join(workspace, "MEMORY.md");
    if (fs.existsSync(memoryMdPath)) {
      const entries = parseMemoryMd(readFileOr(memoryMdPath));
      for (const entry of entries) {
        batchItems.push(
          `[OpenClaw MEMORY.md${entry.category ? ` / ${entry.category}` : ""}] ${entry.text}`,
        );
      }
      logger.info(`Awareness import: found ${entries.length} entries in MEMORY.md`);
    }

    // 2. Import memory/*.md daily logs
    const memoryDir = path.join(workspace, "memory");
    if (fs.existsSync(memoryDir)) {
      const files = fs.readdirSync(memoryDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .slice(-30); // Last 30 days
      for (const file of files) {
        const date = file.replace(".md", "");
        const content = readFileOr(path.join(memoryDir, file));
        const entries = parseDailyMd(content, date);
        for (const entry of entries) {
          batchItems.push(`[OpenClaw daily/${date}] ${entry.text}`);
        }
      }
      logger.info(`Awareness import: found ${files.length} daily log files`);
    }

    // 3. Import session JSONL files (most recent N)
    const sessionsDir = path.join(
      process.env.HOME || "",
      ".openclaw",
      "agents",
      "main",
      "sessions",
    );
    if (fs.existsSync(sessionsDir)) {
      const sessionFiles = fs.readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .slice(-MAX_IMPORT_SESSIONS);
      let sessionCount = 0;
      for (const file of sessionFiles) {
        const summary = parseSessionJsonl(path.join(sessionsDir, file));
        if (summary) {
          batchItems.push(`[OpenClaw session/${file.replace(".jsonl", "")}]\n${summary}`);
          sessionCount++;
        }
      }
      logger.info(`Awareness import: found ${sessionCount} sessions with content`);
    }

    // 4. Batch record to Awareness
    if (batchItems.length > 0) {
      // Split into chunks of 10 to avoid overwhelming the daemon
      for (let i = 0; i < batchItems.length; i += 10) {
        const chunk = batchItems.slice(i, i + 10);
        try {
          await client.record(
            chunk.join("\n\n---\n\n"),
            { event_type: "openclaw_import", source: "openclaw-plugin" },
          );
          imported += chunk.length;
        } catch (err) {
          skipped += chunk.length;
          logger.warn(`Awareness import batch ${i / 10 + 1} failed:`, err);
        }
      }
    }

    // Mark as imported
    markImported(workspace);
    logger.info(
      `Awareness import complete: ${imported} imported, ${skipped} skipped`,
    );
  } catch (err) {
    logger.warn("Awareness import failed:", err);
  }

  return { imported, skipped };
}
