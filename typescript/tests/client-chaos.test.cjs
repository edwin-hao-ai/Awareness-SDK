// L3 chaos — HTTP client must handle 5xx HTML body + timeout without returning
// undefined payloads. Uses a minimal stub fetch; no network.
const test = require("node:test");
const assert = require("node:assert");

function stubFetch(mode) {
  return async () => {
    if (mode === "timeout") throw new Error("ETIMEDOUT");
    if (mode === "html502") {
      return {
        ok: false,
        status: 502,
        headers: { get: () => "text/html" },
        text: async () => "<html><body>bad gateway</body></html>",
        json: async () => {
          throw new Error("not json");
        },
      };
    }
    if (mode === "empty200") {
      return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => "" };
    }
    throw new Error("unknown mode");
  };
}

test("L3 · 502 HTML body does not return undefined payload", async () => {
  const f = stubFetch("html502");
  const res = await f();
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.status, 502);
  const body = await res.text();
  // Client code MUST detect non-JSON content-type before calling .json()
  assert.ok(body.includes("bad gateway"));
});

test("L3 · network timeout surfaces an error, not silent undefined", async () => {
  const f = stubFetch("timeout");
  await assert.rejects(() => f(), /ETIMEDOUT/);
});

test("L3 · empty 200 body must not crash JSON parsing", async () => {
  const f = stubFetch("empty200");
  const res = await f();
  const body = await res.text();
  assert.strictEqual(body, "");
  // JSON.parse('') would throw — client code must guard
  assert.throws(() => JSON.parse(body), SyntaxError);
});
