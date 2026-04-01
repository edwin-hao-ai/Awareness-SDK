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
});
