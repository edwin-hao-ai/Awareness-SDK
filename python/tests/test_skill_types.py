"""Unit tests for `Skill` TypedDict shape (F-059 additions).

Ensures that `pitfalls`, `verification`, and `growth_stage` can be populated
without tripping type errors and that the TypedDict can round-trip through
JSON serialization unchanged — the SDK treats these as passthrough fields
between the backend/daemon and the caller.
"""

import json

import pytest

from memory_cloud.types import GrowthStage, Skill


def _base_skill() -> Skill:
    return Skill(
        id="skill-1",
        memory_id="mem-1",
        name="Deploy with Docker Compose",
        summary="Rebuild backend image and restart dependent services.",
        methods=[{"step": 1, "description": "docker compose build backend"}],
        trigger_conditions=[{"pattern": "deploy", "weight": 1.0}],
        tags=["deployment"],
        source_card_ids=["card-a", "card-b"],
        growth_stage="budding",
        usage_count=3,
        decay_score=0.72,
        pinned=False,
        status="active",
        created_at="2026-04-19T00:00:00Z",
        updated_at="2026-04-19T00:00:00Z",
    )


@pytest.mark.unit
def test_skill_accepts_f059_optional_fields() -> None:
    skill: Skill = _base_skill()
    skill["pitfalls"] = [
        "Do not rebuild postgres — resets scram-sha-256 hash",
        "Avoid `docker compose up` without --env-file .env.prod",
    ]
    skill["verification"] = [
        "curl https://awareness.market/health returns 200",
        "docker compose ps shows all services healthy",
    ]

    assert skill["pitfalls"][0].startswith("Do not rebuild")
    assert len(skill["verification"]) == 2


@pytest.mark.unit
def test_skill_round_trips_through_json_with_new_fields() -> None:
    skill: Skill = _base_skill()
    skill["pitfalls"] = ["p1", "p2"]
    skill["verification"] = ["v1"]

    encoded = json.dumps(skill)
    decoded = json.loads(encoded)

    assert decoded["pitfalls"] == ["p1", "p2"]
    assert decoded["verification"] == ["v1"]
    assert decoded["growth_stage"] == "budding"


@pytest.mark.unit
def test_growth_stage_union_accepts_valid_values() -> None:
    # Literal values — these should all be accepted by type-checkers.
    for stage in ("seedling", "budding", "evergreen"):
        value: GrowthStage = stage  # type: ignore[assignment]
        skill: Skill = _base_skill()
        skill["growth_stage"] = value
        assert skill["growth_stage"] == stage


@pytest.mark.unit
def test_skill_without_f059_fields_is_still_valid() -> None:
    """Back-compat: skills created before F-059 must still parse cleanly."""
    skill: Skill = _base_skill()
    # No `pitfalls` / `verification` keys present.
    assert "pitfalls" not in skill
    assert "verification" not in skill
    # Round-trip still works.
    decoded = json.loads(json.dumps(skill))
    assert "pitfalls" not in decoded
    assert "verification" not in decoded
