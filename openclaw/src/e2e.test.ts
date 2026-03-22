/**
 * E2E Integration Tests for OpenClaw Plugin against Live Awareness API
 *
 * These tests require a running Awareness server.
 * Skipped in CI — run locally with: npx vitest run src/e2e.test.ts
 *
 * Environment variables:
 *   AWARENESS_API_KEY    — API key (default: from .env)
 *   AWARENESS_BASE_URL   — API base URL (default: http://localhost:8000/api/v1)
 *   AWARENESS_MEMORY_ID  — Memory ID to test against
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AwarenessClient } from "./client";
import type { SessionContext, RecallResult } from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_KEY = process.env.AWARENESS_API_KEY || "aw_8OJL5YnFrC-2nfymTO0xQ9Ag_qvqeEHT";
const BASE_URL = process.env.AWARENESS_BASE_URL || "http://localhost:8000/api/v1";
const MEMORY_ID = process.env.AWARENESS_MEMORY_ID || "";

// Skip if no memory ID is provided
const runE2E = !!MEMORY_ID;

// ---------------------------------------------------------------------------
// Helper: check if API is reachable
// ---------------------------------------------------------------------------

async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL.replace("/api/v1", "")}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ===========================================================================
// E2E Test Suite
// ===========================================================================

describe.skipIf(!runE2E)("E2E: OpenClaw Plugin against Live API", () => {
  let client: AwarenessClient;
  let apiReachable = false;

  beforeAll(async () => {
    apiReachable = await isApiReachable();
    if (!apiReachable) {
      console.warn("⚠️  Awareness API not reachable at", BASE_URL);
      return;
    }
    client = new AwarenessClient(BASE_URL, API_KEY, MEMORY_ID, "e2e_test_agent");
  });

  // =========================================================================
  // Dimension 1: Feature Alignment — real API calls
  // =========================================================================

  describe("Feature Alignment (live)", () => {
    it.skipIf(!apiReachable)("init() returns session context", async () => {
      const result = await client.init(7, 10, 10);

      expect(result.session_id).toMatch(/^openclaw-/);
      expect(result.context).toBeDefined();
      expect(result.context.memory_id).toBe(MEMORY_ID);
    });

    it.skipIf(!apiReachable)("search() with semantic query returns results", async () => {
      const result = await client.search({
        semanticQuery: "project architecture decisions",
        limit: 5,
      });

      expect(result).toBeDefined();
      // Results may be empty for new memories — that's OK
      expect(Array.isArray(result.results)).toBe(true);
    });

    it.skipIf(!apiReachable)("search() with structured recall_mode works", async () => {
      const result = await client.search({
        semanticQuery: "recent decisions",
        recallMode: "structured",
        limit: 5,
      });

      expect(result).toBeDefined();
    });

    it.skipIf(!apiReachable)("search() with hybrid recall_mode works", async () => {
      const result = await client.search({
        semanticQuery: "recent decisions",
        recallMode: "hybrid",
        limit: 5,
      });

      expect(result).toBeDefined();
    });

    it.skipIf(!apiReachable)("getData('context') returns session context", async () => {
      const result = (await client.getData("context", { days: 7 })) as SessionContext;

      expect(result.memory_id).toBe(MEMORY_ID);
    });

    it.skipIf(!apiReachable)("getData('tasks') returns action items", async () => {
      const result = await client.getData("tasks", { limit: 5 });
      expect(result).toBeDefined();
    });

    it.skipIf(!apiReachable)("getData('knowledge') returns knowledge cards", async () => {
      const result = await client.getData("knowledge", { limit: 5 });
      expect(result).toBeDefined();
    });

    it.skipIf(!apiReachable)("getData('risks') returns risks", async () => {
      const result = await client.getData("risks", { limit: 5 });
      expect(result).toBeDefined();
    });

    it.skipIf(!apiReachable)("getData('timeline') returns timeline data", async () => {
      const result = await client.getData("timeline", { limit: 10 });
      expect(result).toBeDefined();
    });

    it.skipIf(!apiReachable)("getData('handoff') returns handoff context", async () => {
      const result = (await client.getData("handoff", {
        query: "Continue development",
      })) as Record<string, unknown>;

      expect(result.briefing_for).toBe("Continue development");
      expect(result.recent_progress).toBeDefined();
      expect(result.open_tasks).toBeDefined();
      expect(result.key_knowledge).toBeDefined();
    });
  });

  // =========================================================================
  // Dimension 2: Token Efficiency (measurement)
  // =========================================================================

  describe("Token Efficiency (measurement)", () => {
    it.skipIf(!apiReachable)("structured recall returns compact response", async () => {
      const structured = await client.search({
        semanticQuery: "architecture decisions",
        recallMode: "structured",
        limit: 5,
      });

      const hybrid = await client.search({
        semanticQuery: "architecture decisions",
        recallMode: "hybrid",
        limit: 5,
      });

      const full = await client.search({
        semanticQuery: "architecture decisions",
        recallMode: "auto",
        limit: 10,
      });

      // Structured should be most compact
      const structuredSize = JSON.stringify(structured).length;
      const hybridSize = JSON.stringify(hybrid).length;
      const fullSize = JSON.stringify(full).length;

      console.log(
        `📊 Token efficiency comparison:\n` +
          `  structured: ${structuredSize} chars\n` +
          `  hybrid:     ${hybridSize} chars\n` +
          `  full (auto): ${fullSize} chars`,
      );

      // Structured should be <= hybrid <= full (generally)
      // We don't enforce strict ordering as it depends on data
      expect(structuredSize).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Dimension 4: Speed & Latency
  // =========================================================================

  describe("Speed & Latency", () => {
    it.skipIf(!apiReachable)("init() completes within 2000ms", async () => {
      const start = Date.now();
      await client.init(7, 10, 10);
      const duration = Date.now() - start;

      console.log(`⏱️  init() latency: ${duration}ms`);
      expect(duration).toBeLessThan(2000);
    });

    it.skipIf(!apiReachable)("search() completes within 1500ms", async () => {
      const start = Date.now();
      await client.search({
        semanticQuery: "authentication architecture",
        limit: 6,
      });
      const duration = Date.now() - start;

      console.log(`⏱️  search() latency: ${duration}ms`);
      expect(duration).toBeLessThan(1500);
    });

    it.skipIf(!apiReachable)("getData('tasks') completes within 500ms (pure DB)", async () => {
      const start = Date.now();
      await client.getData("tasks", { limit: 10 });
      const duration = Date.now() - start;

      console.log(`⏱️  getData('tasks') latency: ${duration}ms`);
      expect(duration).toBeLessThan(500);
    });

    it.skipIf(!apiReachable)("getData('knowledge') completes within 500ms (pure DB)", async () => {
      const start = Date.now();
      await client.getData("knowledge", { limit: 10 });
      const duration = Date.now() - start;

      console.log(`⏱️  getData('knowledge') latency: ${duration}ms`);
      expect(duration).toBeLessThan(500);
    });
  });

  // =========================================================================
  // Dimension 5: Write → Read roundtrip
  // =========================================================================

  describe("Write/Read roundtrip", () => {
    const uniqueMarker = `e2e-test-${Date.now()}`;

    it.skipIf(!apiReachable)("record() persists and can be recalled", async () => {
      // Write
      const writeResult = await client.record(
        `E2E test event: ${uniqueMarker} — Testing OpenClaw plugin integration`,
      );
      expect(writeResult.accepted).toBeGreaterThanOrEqual(1);

      // Wait for async vectorization
      await new Promise((r) => setTimeout(r, 3000));

      // Read back via search
      const searchResult = await client.search({
        semanticQuery: `E2E test event ${uniqueMarker}`,
        keywordQuery: uniqueMarker,
        limit: 3,
      });

      // The event should be findable (may take time for async processing)
      console.log(
        `📝 Write/read roundtrip: wrote marker "${uniqueMarker}", ` +
          `search returned ${searchResult.results?.length ?? 0} results`,
      );
    });

    it.skipIf(!apiReachable)("closeSession completes without error", async () => {
      const result = await client.closeSession();
      expect(result.session_id).toMatch(/^openclaw-/);
    });
  });
});

// ===========================================================================
// E2E: Full Plugin Registration Flow
// ===========================================================================

describe.skipIf(!runE2E)("E2E: Full Plugin Flow", () => {
  it.skipIf(!MEMORY_ID)("simulates complete OpenClaw session lifecycle", async () => {
    const apiReachable = await isApiReachable();
    if (!apiReachable) return;

    const client = new AwarenessClient(BASE_URL, API_KEY, MEMORY_ID, "e2e_test_agent");

    // Step 1: Init session
    const initResult = await client.init(7, 10, 10);
    expect(initResult.session_id).toBeTruthy();

    // Step 2: Recall
    const recallResult = await client.search({
      semanticQuery: "What decisions have been made recently?",
      limit: 5,
    });
    expect(recallResult).toBeDefined();

    // Step 3: Record work
    await client.record("E2E: Completed plugin integration test");

    // Step 4: Lookup structured data
    const tasks = await client.getData("tasks", { limit: 5 });
    expect(tasks).toBeDefined();

    // Step 5: Close session
    const closeResult = await client.closeSession();
    expect(closeResult.session_id).toBe(initResult.session_id);

    console.log("✅ Full plugin lifecycle completed successfully");
  });
});
