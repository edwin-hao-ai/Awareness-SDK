// Unit test for the `Skill` interface (F-059 additions).
//
// The SDK passes skill payloads through as plain JSON, so we only need to
// verify that an object shaped like our new `Skill` type round-trips through
// JSON and keeps `pitfalls`, `verification`, and `growth_stage` intact.
//
// This file is `.cjs` on purpose — it matches the rest of the test suite,
// which executes against the compiled `dist/` output via `node --test`.

const test = require("node:test");
const assert = require("node:assert/strict");

test("Skill shape: pitfalls/verification/growth_stage survive JSON round-trip", () => {
  /** @type {import("../src/types").Skill} */
  const skill = {
    id: "skill-1",
    memory_id: "mem-1",
    name: "Deploy with Docker Compose",
    summary: "Rebuild backend and restart dependent services.",
    methods: [{ step: 1, description: "docker compose build backend" }],
    trigger_conditions: [{ pattern: "deploy", weight: 1.0 }],
    tags: ["deployment"],
    source_card_ids: ["card-a", "card-b"],
    growth_stage: "budding",
    pitfalls: [
      "Do not rebuild postgres — resets scram-sha-256 hash",
      "Avoid `docker compose up` without --env-file .env.prod",
    ],
    verification: [
      "curl https://awareness.market/health returns 200",
      "docker compose ps shows all services healthy",
    ],
    usage_count: 3,
    decay_score: 0.72,
    pinned: false,
    status: "active",
    created_at: "2026-04-19T00:00:00Z",
    updated_at: "2026-04-19T00:00:00Z",
  };

  const decoded = JSON.parse(JSON.stringify(skill));

  assert.equal(decoded.growth_stage, "budding");
  assert.deepEqual(decoded.pitfalls, skill.pitfalls);
  assert.deepEqual(decoded.verification, skill.verification);
  assert.equal(decoded.pitfalls.length, 2);
  assert.equal(decoded.verification.length, 2);
});

test("Skill shape: pitfalls/verification are optional (back-compat)", () => {
  /** @type {import("../src/types").Skill} */
  const skill = {
    id: "skill-2",
    memory_id: "mem-1",
    name: "Legacy skill without F-059 fields",
    summary: "Kept around to test optional-field back-compat.",
    methods: [],
    trigger_conditions: [],
    tags: [],
    source_card_ids: [],
    growth_stage: "seedling",
    usage_count: 0,
    decay_score: 1.0,
    pinned: false,
    status: "active",
    created_at: "2026-04-19T00:00:00Z",
    updated_at: "2026-04-19T00:00:00Z",
  };

  const decoded = JSON.parse(JSON.stringify(skill));
  assert.equal(decoded.pitfalls, undefined);
  assert.equal(decoded.verification, undefined);
  assert.equal(decoded.growth_stage, "seedling");
});
