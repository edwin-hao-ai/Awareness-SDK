import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AwarenessClient } from "./client";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

describe("AwarenessClient local recall", () => {
  it("passes init query through to local awareness_init", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                user_preferences: [],
                knowledge_cards: [],
                open_tasks: [],
                recent_sessions: [],
                attention_summary: { needs_attention: false },
                rendered_context: "<awareness-memory />",
              }),
            },
          ],
        },
      }),
    );

    const client = new AwarenessClient(
      "http://localhost:37800/api/v1",
      "",
      "local",
      "builder_agent",
    );

    await client.init(7, 8, 8, "How should auth be implemented?");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params.arguments.query).toBe("How should auth be implemented?");
  });

  it("preserves IDs and structure from two-block summary recall", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        result: {
          content: [
            {
              type: "text",
              text:
                "Found 2 memories:\n\n" +
                "1. [decision] JWT auth\n   Use JWT for session tokens\n\n" +
                "2. [workflow] Release flow\n   Build, test, then deploy",
            },
            {
              type: "text",
              text: JSON.stringify({
                _ids: ["kc_jwt", "kc_release"],
                _meta: { detail: "summary", total: 2, mode: "local" },
              }),
            },
          ],
        },
      }),
    );

    const client = new AwarenessClient(
      "http://localhost:37800/api/v1",
      "",
      "local",
      "builder_agent",
    );

    const result = await client.search({
      semanticQuery: "auth decision",
      detail: "summary",
    });

    expect(result.results).toHaveLength(2);
    expect(result.results?.[0]).toMatchObject({
      id: "kc_jwt",
      type: "decision",
      title: "JWT auth",
      summary: "Use JWT for session tokens",
    });
    expect(result.results?.[1]).toMatchObject({
      id: "kc_release",
      type: "workflow",
      title: "Release flow",
      summary: "Build, test, then deploy",
    });
  });

  it("falls back to raw content when local full recall returns readable text", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        result: {
          content: [
            {
              type: "text",
              text: "## JWT auth\n\nUse JWT for session tokens",
            },
          ],
        },
      }),
    );

    const client = new AwarenessClient(
      "http://localhost:37800/api/v1",
      "",
      "local",
      "builder_agent",
    );

    const result = await client.search({
      semanticQuery: "auth decision",
      detail: "full",
      ids: ["kc_jwt"],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]?.content).toContain("JWT auth");
  });

  // ---------------------------------------------------------------------
  // F-053 single-parameter daemon args alignment (2026-04-18)
  // ---------------------------------------------------------------------

  it("local search sends F-053 single-param `query` field (preferred over semanticQuery)", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        result: { content: [{ type: "text", text: "Found 0 memories:" }] },
      }),
    );
    const client = new AwarenessClient(
      "http://localhost:37800/api/v1",
      "",
      "local",
      "builder_agent",
    );
    await client.search({ query: "why did we pick pgvector over Pinecone" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const args = body.params.arguments;
    expect(args.query).toBe("why did we pick pgvector over Pinecone");
    expect(args.limit).toBeGreaterThan(0);
    // F-053 regression guards: daemon_args must be clean single-param.
    expect(args).not.toHaveProperty("semantic_query");
    expect(args).not.toHaveProperty("keyword_query");
    expect(args).not.toHaveProperty("detail");
  });

  it("local search forwards tokenBudget as `token_budget` for bucket-tier shaping", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        result: { content: [{ type: "text", text: "Found 0 memories:" }] },
      }),
    );
    const client = new AwarenessClient(
      "http://localhost:37800/api/v1",
      "",
      "local",
      "builder_agent",
    );
    await client.search({ query: "test", tokenBudget: 50000, limit: 10 });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const args = body.params.arguments;
    expect(args.token_budget).toBe(50000);
    expect(args.limit).toBe(10);
  });

  it("local search legacy compat: falls back to semanticQuery when query absent", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        result: { content: [{ type: "text", text: "Found 0 memories:" }] },
      }),
    );
    const client = new AwarenessClient(
      "http://localhost:37800/api/v1",
      "",
      "local",
      "builder_agent",
    );
    await client.search({ semanticQuery: "legacy call" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const args = body.params.arguments;
    // Legacy semanticQuery is hoisted to the single-param `query` field.
    expect(args.query).toBe("legacy call");
    // No double-sending under the old key.
    expect(args).not.toHaveProperty("semantic_query");
  });

  it("local search forwards explicit keywordQuery only when `query` absent (deprecation signal)", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        result: { content: [{ type: "text", text: "Found 0 memories:" }] },
      }),
    );
    const client = new AwarenessClient(
      "http://localhost:37800/api/v1",
      "",
      "local",
      "builder_agent",
    );
    // Pure legacy call — no query, only keywordQuery
    await client.search({ semanticQuery: "fallback", keywordQuery: "pgvector pinecone" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const args = body.params.arguments;
    expect(args.query).toBe("fallback");
    expect(args.keyword_query).toBe("pgvector pinecone");
  });

  it("local search with explicit query does NOT forward keywordQuery (single-param wins)", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        result: { content: [{ type: "text", text: "Found 0 memories:" }] },
      }),
    );
    const client = new AwarenessClient(
      "http://localhost:37800/api/v1",
      "",
      "local",
      "builder_agent",
    );
    await client.search({ query: "modern single-param call", keywordQuery: "should be dropped" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const args = body.params.arguments;
    expect(args.query).toBe("modern single-param call");
    expect(args).not.toHaveProperty("keyword_query");
  });
});
