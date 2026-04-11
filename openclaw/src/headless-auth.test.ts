import { describe, it, expect } from "vitest";
import {
  isHeadlessEnv,
  openBrowserSilently,
  renderDeviceCodeBox,
  DEFAULT_POLL_TIMEOUT_SEC,
} from "./headless-auth";

describe("isHeadlessEnv", () => {
  it("respects explicit AWARENESS_HEADLESS=1", () => {
    expect(
      isHeadlessEnv({
        env: { AWARENESS_HEADLESS: "1", DISPLAY: ":0" },
        platform: "linux",
        isTTY: true,
      }),
    ).toBe(true);
  });

  it("respects explicit AWARENESS_HEADLESS=0 even on SSH host", () => {
    expect(
      isHeadlessEnv({
        env: {
          AWARENESS_HEADLESS: "0",
          SSH_CONNECTION: "1.2.3.4 22 5.6.7.8 22",
        },
        platform: "linux",
        isTTY: true,
      }),
    ).toBe(false);
  });

  it("detects SSH sessions", () => {
    expect(
      isHeadlessEnv({
        env: { SSH_CONNECTION: "1.2.3.4 22 5.6.7.8 22", DISPLAY: ":0" },
        platform: "linux",
        isTTY: true,
      }),
    ).toBe(true);
  });

  it("detects GitHub Codespaces", () => {
    expect(
      isHeadlessEnv({
        env: { CODESPACES: "true", DISPLAY: ":0" },
        platform: "linux",
        isTTY: true,
      }),
    ).toBe(true);
  });

  it("detects Gitpod", () => {
    expect(
      isHeadlessEnv({
        env: { GITPOD_WORKSPACE_ID: "ws-abc", DISPLAY: ":0" },
        platform: "linux",
        isTTY: true,
      }),
    ).toBe(true);
  });

  it("treats Linux without DISPLAY as headless", () => {
    expect(
      isHeadlessEnv({ env: {}, platform: "linux", isTTY: true }),
    ).toBe(true);
  });

  it("treats macOS desktop as non-headless by default", () => {
    expect(
      isHeadlessEnv({ env: {}, platform: "darwin", isTTY: true }),
    ).toBe(false);
  });

  it("treats Windows desktop as non-headless by default", () => {
    expect(
      isHeadlessEnv({ env: {}, platform: "win32", isTTY: true }),
    ).toBe(false);
  });

  it("treats missing TTY as headless (piped/CI)", () => {
    expect(
      isHeadlessEnv({ env: {}, platform: "darwin", isTTY: false }),
    ).toBe(true);
  });

  it("treats Linux with WAYLAND_DISPLAY as non-headless", () => {
    expect(
      isHeadlessEnv({
        env: { WAYLAND_DISPLAY: "wayland-0" },
        platform: "linux",
        isTTY: true,
      }),
    ).toBe(false);
  });
});

describe("renderDeviceCodeBox", () => {
  const base = {
    userCode: "A3K9-M7FX",
    verificationUri: "https://awareness.market/cli-auth?code=A3K9-M7FX",
    expiresInSec: 900,
  };

  it("contains the user code", () => {
    expect(renderDeviceCodeBox({ ...base, headless: true })).toContain("A3K9-M7FX");
  });

  it("contains the verification URL", () => {
    expect(renderDeviceCodeBox({ ...base, headless: true })).toContain(
      "awareness.market/cli-auth",
    );
  });

  it("shows headless-specific message when headless", () => {
    expect(renderDeviceCodeBox({ ...base, headless: true })).toMatch(
      /Headless.*remote host detected/,
    );
  });

  it("shows tried-to-open message when not headless", () => {
    expect(renderDeviceCodeBox({ ...base, headless: false })).toMatch(
      /tried to open your browser/,
    );
  });

  it("renders ttl line with minutes", () => {
    expect(
      renderDeviceCodeBox({ ...base, expiresInSec: 900, headless: true }),
    ).toMatch(/Code expires in ~15 minutes/);
  });

  it("uses singular 'minute' for 60s TTL", () => {
    expect(
      renderDeviceCodeBox({ ...base, expiresInSec: 60, headless: true }),
    ).toMatch(/Code expires in ~1 minute\./);
  });

  it("handles very long URLs without crashing", () => {
    const longUrl =
      "https://awareness.market/cli-auth?code=ABCD-EFGH&next=" + "x".repeat(300);
    const box = renderDeviceCodeBox({
      userCode: "ABCD-EFGH",
      verificationUri: longUrl,
      headless: true,
    });
    expect(box.length).toBeGreaterThan(0);
    expect(box).toContain("ABCD-EFGH");
  });

  it("accepts custom product name", () => {
    const box = renderDeviceCodeBox({
      ...base,
      headless: true,
      product: "Awareness Memory",
    });
    expect(box).toContain("Awareness Memory Device Authorization");
  });
});

describe("openBrowserSilently", () => {
  it("returns a boolean without throwing", () => {
    const result = openBrowserSilently(
      "https://example.com/headless-auth-test-nothing-real",
    );
    expect(typeof result).toBe("boolean");
  });
});

describe("DEFAULT_POLL_TIMEOUT_SEC", () => {
  it("is between 300 and 900 seconds", () => {
    expect(DEFAULT_POLL_TIMEOUT_SEC).toBeGreaterThan(300);
    expect(DEFAULT_POLL_TIMEOUT_SEC).toBeLessThan(900);
  });
});
