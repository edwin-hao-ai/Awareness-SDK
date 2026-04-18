/**
 * F-055 bug B — tests for stripMetadataEnvelope.
 *
 * The OpenClaw runtime wraps every agent turn in metadata envelopes:
 * - `Sender (untrusted metadata): ...`
 * - `[Operational context metadata ...]`
 * - `[Subagent Context]`
 * - `Request:` / `Result:` / `Send:` line-prefix wrappers
 *
 * Before F-055, the plugin's `agent_end` hook took the first 300 chars of
 * `firstUserMessage` verbatim, so "Request: Sender (untrusted metadata): ..."
 * leaked into every memory title. The fix is a plugin-side strip pass.
 */
import { describe, expect, test } from "vitest";
import { stripMetadataEnvelope } from "./envelope-strip.js";

describe("stripMetadataEnvelope", () => {
  // ---- Normal content passes through untouched ----------------------------

  test("plain user message returns unchanged", () => {
    const input = "怎么修 workspace 切换 bug？";
    expect(stripMetadataEnvelope(input)).toBe(input);
  });

  test("plain multi-line user message preserved", () => {
    const input = "Line one\nLine two\nLine three";
    expect(stripMetadataEnvelope(input)).toBe(input);
  });

  test("English plain sentence preserved", () => {
    const input = "How do I deploy the backend?";
    expect(stripMetadataEnvelope(input)).toBe(input);
  });

  // ---- Single-layer envelope strip ---------------------------------------

  test("strips leading `Sender (untrusted metadata):` block", () => {
    const input = "Sender (untrusted metadata): openclaw-runtime\n\nHello?";
    expect(stripMetadataEnvelope(input)).toBe("Hello?");
  });

  test("strips `[Operational context metadata ...]` block", () => {
    const input =
      "[Operational context metadata — do not answer this section directly]\n\nWhat is pgvector?";
    expect(stripMetadataEnvelope(input)).toBe("What is pgvector?");
  });

  test("strips `[Subagent Context]` block", () => {
    const input = "[Subagent Context]\nSome handoff text\n\nTell me the status.";
    expect(stripMetadataEnvelope(input)).toBe("Tell me the status.");
  });

  test("strips `Request:` line prefix", () => {
    const input = "Request: 怎么做牛肉面？";
    expect(stripMetadataEnvelope(input)).toBe("怎么做牛肉面？");
  });

  test("strips `Result:` line prefix", () => {
    const input = "Result: 这是做法";
    expect(stripMetadataEnvelope(input)).toBe("这是做法");
  });

  test("strips `Send:` line prefix", () => {
    const input = "Send: payload here";
    expect(stripMetadataEnvelope(input)).toBe("payload here");
  });

  // ---- Multi-layer / nested envelopes ------------------------------------

  test("strips `Sender (...)` + `Request:` nested", () => {
    const input =
      "Sender (untrusted metadata): system\n\nRequest: 怎么修 workspace 切换 bug？";
    expect(stripMetadataEnvelope(input)).toBe("怎么修 workspace 切换 bug？");
  });

  test("strips `Operational context` + `Subagent Context` stacked", () => {
    const input =
      "[Operational context metadata — skip]\n\n[Subagent Context]\ntask handoff\n\nActual question?";
    expect(stripMetadataEnvelope(input)).toBe("Actual question?");
  });

  test("strips triple-nested envelopes", () => {
    const input =
      "Sender (untrusted metadata): x\n\n[Operational context metadata — skip]\n\nRequest: real question";
    expect(stripMetadataEnvelope(input)).toBe("real question");
  });

  // ---- Envelope-only content returns empty -------------------------------

  test("envelope-only input returns empty string", () => {
    const input = "Sender (untrusted metadata): foo\n\n[Subagent Context]";
    expect(stripMetadataEnvelope(input)).toBe("");
  });

  test("just `Request:` prefix with nothing after returns empty", () => {
    const input = "Request:";
    expect(stripMetadataEnvelope(input)).toBe("");
  });

  test("whitespace-only envelope-stripped content returns empty", () => {
    const input = "Sender (untrusted metadata): foo\n\n   \t\n";
    expect(stripMetadataEnvelope(input)).toBe("");
  });

  // ---- Robustness / malformed input --------------------------------------

  test("empty string returns empty", () => {
    expect(stripMetadataEnvelope("")).toBe("");
  });

  test("non-string input handled safely (undefined)", () => {
    expect(stripMetadataEnvelope(undefined as unknown as string)).toBe("");
  });

  test("non-string input handled safely (null)", () => {
    expect(stripMetadataEnvelope(null as unknown as string)).toBe("");
  });

  test("non-string input handled safely (number)", () => {
    expect(stripMetadataEnvelope(42 as unknown as string)).toBe("");
  });

  test("malformed 100KB input does not throw and truncates", () => {
    const big = "x".repeat(100_000);
    const out = stripMetadataEnvelope(big);
    expect(typeof out).toBe("string");
    expect(out.length).toBeLessThanOrEqual(2000);
  });

  test("Chinese-only envelope pattern still preserves plain Chinese content", () => {
    const input = "周末想做清汤牛肉面，有什么建议？";
    expect(stripMetadataEnvelope(input)).toBe(input);
  });

  test("does not over-strip: `Requester:` is NOT the Request: prefix", () => {
    const input = "Requester: Alice, can you help?";
    expect(stripMetadataEnvelope(input)).toBe(input);
  });

  test("does not strip `Request:` when it appears mid-line", () => {
    const input = "My Request: button is broken";
    expect(stripMetadataEnvelope(input)).toBe(input);
  });

  test("case-insensitive envelope match (REQUEST:)", () => {
    const input = "REQUEST: do it";
    expect(stripMetadataEnvelope(input)).toBe("do it");
  });

  test("leading whitespace before envelope is tolerated", () => {
    const input = "   Request:   padded";
    expect(stripMetadataEnvelope(input)).toBe("padded");
  });

  test("envelope with real content on same line after colon still strips prefix", () => {
    const input = "Request: How do I configure it?";
    expect(stripMetadataEnvelope(input)).toBe("How do I configure it?");
  });
});
