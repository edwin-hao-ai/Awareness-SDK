"""
Python SDK Functional Integration Tests — real HTTP calls via MemoryCloudClient.

Run locally (requires backend running on localhost:8000):
  cd sdks/python
  python -m pytest tests/test_sdk_functional.py -v -s

Skipped in CI via @pytest.mark.requires_live_api.

These tests simulate a complete user journey through the SDK:
  create -> list -> get -> update -> record (3 variants) -> list_content ->
  retrieve -> recall_for_task -> session_context -> knowledge_base ->
  insights -> timeline -> pending_tasks -> handoff_context ->
  detect_agent_role -> list_agents -> get_memory_users -> delete
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime

import pytest

from memory_cloud.client import MemoryCloudClient
from memory_cloud.errors import MemoryCloudError

logger = logging.getLogger("test_sdk_functional")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

API_BASE_URL = os.getenv(
    "AWARENESS_API_BASE_URL", "http://localhost:8000/api/v1"
)
API_KEY = os.getenv(
    "AWARENESS_API_KEY", "aw_-PycLiTUx-TjvVyZJ0iY6KJRFI8Yau8R"
)


# ---------------------------------------------------------------------------
# Module-scoped fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client() -> MemoryCloudClient:
    """Shared SDK client for the entire test module."""
    return MemoryCloudClient(
        base_url=API_BASE_URL,
        api_key=API_KEY,
        timeout=30.0,
        max_retries=2,
        default_source="sdk-functest",
    )


@pytest.fixture(scope="module")
def memory_id(client: MemoryCloudClient) -> str:
    """Create a test memory at module start; delete it at module end."""
    name = f"SDK Functional Test {datetime.now().isoformat()}"
    result = client.create_memory({
        "name": name,
        "custom_type": "universal",
        "config": {"vector_dim": 768},
        "owner_id": "sdk-functest-user",
    })
    mid = result["id"]
    logger.info("Created test memory: %s (%s)", mid, name)
    yield mid
    # Cleanup
    try:
        client.delete_memory(mid)
        logger.info("Deleted test memory: %s", mid)
    except Exception as exc:
        logger.warning("Cleanup failed for memory %s: %s", mid, exc)


# ---------------------------------------------------------------------------
# Ordered test class — methods run top-to-bottom within the class
# ---------------------------------------------------------------------------

@pytest.mark.requires_live_api
class TestSDKFunctionalJourney:
    """Complete user journey through the Python SDK, executed in order."""

    # -- 1. create_memory (done by fixture, verify result) --

    def test_01_create_memory(self, client: MemoryCloudClient, memory_id: str):
        """Verify the memory was created successfully."""
        assert memory_id, "memory_id fixture should return a non-empty string"
        assert isinstance(memory_id, str)
        assert len(memory_id) > 0

    # -- 2. list_memories --

    def test_02_list_memories(self, client: MemoryCloudClient, memory_id: str):
        """list_memories should include the test memory."""
        memories = client.list_memories(owner_id="sdk-functest-user", limit=200)
        assert isinstance(memories, list)
        assert len(memories) > 0
        ids = [m.get("id") for m in memories]
        assert memory_id in ids, f"Test memory {memory_id} not found in list"

    # -- 3. get_memory --

    def test_03_get_memory(self, client: MemoryCloudClient, memory_id: str):
        """get_memory should return the test memory with correct fields."""
        mem = client.get_memory(memory_id)
        assert isinstance(mem, dict)
        assert mem.get("id") == memory_id
        assert "name" in mem
        assert "SDK Functional Test" in mem["name"]

    # -- 4. update_memory --

    def test_04_update_memory(self, client: MemoryCloudClient, memory_id: str):
        """update_memory should change the name."""
        new_name = f"SDK Functional Test (updated) {datetime.now().isoformat()}"
        result = client.update_memory(memory_id, {"name": new_name})
        assert isinstance(result, dict)
        # Verify the update took effect
        mem = client.get_memory(memory_id)
        assert "(updated)" in mem.get("name", "")

    # -- 5. record() with string content (scope=timeline) --

    def test_05_record_string_content(self, client: MemoryCloudClient, memory_id: str):
        """record() with a plain string should succeed."""
        result = client.record(
            memory_id=memory_id,
            content="Decided to use a combined relational + vector database for embeddings, "
                "so we keep structured and semantic data together.",
            scope="timeline",
            source="sdk-functest",
        )
        assert isinstance(result, dict)
        assert result.get("memory_id") == memory_id
        assert "session_id" in result
        assert result.get("events_sent", 0) >= 1

    # -- 6. record() with list content (scope=timeline) --

    def test_06_record_list_content(self, client: MemoryCloudClient, memory_id: str):
        """record() with a list of strings should batch-ingest."""
        result = client.record(
            memory_id=memory_id,
            content=[
                "User asked: How should we handle authentication?",
                "AI decided: Use JWT with RS256. Access tokens expire in 15 minutes, refresh tokens in 7 days.",
                "Implemented token rotation in auth/jwt_service.py with automatic refresh on 401 responses.",
            ],
            scope="timeline",
            source="sdk-functest",
        )
        assert isinstance(result, dict)
        assert result.get("events_sent", 0) >= 3

    # -- 7. record() with dict knowledge (scope=knowledge) --

    def test_07_record_dict_knowledge(self, client: MemoryCloudClient, memory_id: str):
        """record() with a dict and scope=knowledge should store knowledge content."""
        result = client.record(
            memory_id=memory_id,
            content={
                "content": "Rate limiting configuration: 100 req/min for API, 10 req/min for auth endpoints. "
                           "Uses Redis-backed token bucket algorithm. File: middleware/rate_limit.py",
            },
            scope="knowledge",
            source="sdk-functest",
        )
        assert isinstance(result, dict)
        assert result.get("events_sent", 0) >= 1

    # -- 8. list_memory_content --

    def test_08_list_memory_content(self, client: MemoryCloudClient, memory_id: str):
        """list_memory_content should return a list (may be empty if worker not running)."""
        # Vectorization is async via background workers; if workers are not running,
        # the content list may be empty even after recording.
        time.sleep(3)
        items = client.list_memory_content(memory_id, limit=50)
        assert isinstance(items, list)
        if items:
            assert isinstance(items[0], dict)
            logger.info("list_memory_content returned %d items", len(items))
        else:
            logger.warning(
                "list_memory_content returned 0 items — Celery worker may not be running"
            )
        logger.info("list_memory_content returned %d items", len(items))

    # -- 9. retrieve (semantic search) --

    def test_09_retrieve(self, client: MemoryCloudClient, memory_id: str):
        """retrieve() should return semantically relevant results."""
        # Wait a bit more for vectorization
        time.sleep(2)

        result = client.retrieve(
            memory_id=memory_id,
            query="how does authentication work in our system",
            limit=10,
            recall_mode="precise",
        )
        assert isinstance(result, dict)
        results = result.get("results", [])
        logger.info("retrieve returned %d results", len(results))
        # May be empty if vectorization not complete, but should not error
        if results:
            # Check that at least one result has content
            assert any(r.get("content") or r.get("text") for r in results)

    # -- 10. recall_for_task --

    def test_10_recall_for_task(self, client: MemoryCloudClient, memory_id: str):
        """recall_for_task() should return structured recall data."""
        result = client.recall_for_task(
            memory_id=memory_id,
            task="Review the authentication implementation and check for security issues",
            limit=10,
            recall_mode="hybrid",
        )
        assert isinstance(result, dict)
        assert result.get("memory_id") == memory_id
        assert "session_id" in result
        assert "results" in result
        assert isinstance(result["results"], list)
        logger.info("recall_for_task returned %d results", len(result["results"]))

    # -- 11. get_session_context --

    def test_11_get_session_context(self, client: MemoryCloudClient, memory_id: str):
        """get_session_context() should return structured context."""
        result = client.get_session_context(
            memory_id=memory_id,
            days=7,
            max_cards=10,
            max_tasks=20,
        )
        assert isinstance(result, dict)
        assert result.get("memory_id") == memory_id
        # These keys should exist (may be empty for fresh memory)
        assert "recent_days" in result or "recentDays" in result
        logger.info(
            "get_session_context: %d recent_days, %d open_tasks, %d knowledge_cards",
            len(result.get("recent_days", result.get("recentDays", []))),
            len(result.get("open_tasks", result.get("openTasks", []))),
            len(result.get("knowledge_cards", result.get("knowledgeCards", []))),
        )

    # -- 12. get_knowledge_base --

    def test_12_get_knowledge_base(self, client: MemoryCloudClient, memory_id: str):
        """get_knowledge_base() should return without error."""
        result = client.get_knowledge_base(
            memory_id=memory_id,
            limit=20,
        )
        assert isinstance(result, dict)
        assert "total" in result
        assert "cards" in result
        assert isinstance(result["cards"], list)
        logger.info("get_knowledge_base: %d cards", result["total"])

    # -- 13. insights --

    def test_13_insights(self, client: MemoryCloudClient, memory_id: str):
        """insights() should return without error (may be empty for fresh memory)."""
        result = client.insights(memory_id=memory_id, limit=50)
        assert isinstance(result, dict)
        # Should not raise; content depends on LLM extraction availability

    # -- 14. memory_timeline --

    def test_14_memory_timeline(self, client: MemoryCloudClient, memory_id: str):
        """memory_timeline() should return timeline data."""
        result = client.memory_timeline(
            memory_id=memory_id,
            limit=100,
        )
        assert isinstance(result, dict)
        # Timeline may have events or daily_summaries
        logger.info("memory_timeline keys: %s", list(result.keys()))

    # -- 15. get_pending_tasks --

    def test_15_get_pending_tasks(self, client: MemoryCloudClient, memory_id: str):
        """get_pending_tasks() should return structured task data (may be empty)."""
        result = client.get_pending_tasks(
            memory_id=memory_id,
            limit=30,
        )
        assert isinstance(result, dict)
        assert "total" in result
        assert "tasks" in result
        assert isinstance(result["tasks"], list)
        logger.info("get_pending_tasks: %d total tasks", result["total"])

    # -- 16. get_handoff_context --

    def test_16_get_handoff_context(self, client: MemoryCloudClient, memory_id: str):
        """get_handoff_context() should return a structured briefing."""
        result = client.get_handoff_context(
            memory_id=memory_id,
            current_task="Continue working on the authentication module",
        )
        assert isinstance(result, dict)
        assert result.get("memory_id") == memory_id
        assert "briefing_for" in result
        assert "recent_progress" in result
        assert "open_tasks" in result
        assert "key_knowledge" in result
        assert "token_estimate" in result
        assert isinstance(result["token_estimate"], (int, float))

    # -- 17. detect_agent_role --

    def test_17_detect_agent_role(self, client: MemoryCloudClient, memory_id: str):
        """detect_agent_role() should not raise (result depends on memory config)."""
        try:
            result = client.detect_agent_role(
                memory_id=memory_id,
                content="I need to review the database schema and fix the migration",
            )
            assert isinstance(result, dict)
            logger.info("detect_agent_role result: %s", result)
        except MemoryCloudError as exc:
            # 404 or 400 is acceptable if memory has no agent_profiles configured
            assert exc.status_code in (400, 404, 422), (
                f"Unexpected error from detect_agent_role: {exc.code} {exc.message}"
            )
            logger.info("detect_agent_role returned expected error: %s", exc.code)

    # -- 18. list_agents --

    def test_18_list_agents(self, client: MemoryCloudClient, memory_id: str):
        """list_agents() should return agent list (may be empty)."""
        try:
            result = client.list_agents(memory_id=memory_id)
            assert isinstance(result, dict)
            assert "agents" in result
            assert isinstance(result["agents"], list)
            logger.info("list_agents: %d agents", len(result["agents"]))
        except MemoryCloudError as exc:
            # 404 is acceptable if agents endpoint not available for this memory
            assert exc.status_code in (400, 404), (
                f"Unexpected error from list_agents: {exc.code} {exc.message}"
            )

    # -- 19. get_memory_users --

    def test_19_get_memory_users(self, client: MemoryCloudClient, memory_id: str):
        """get_memory_users() should return user list (may be empty)."""
        result = client.get_memory_users(
            memory_id=memory_id,
            limit=50,
        )
        assert isinstance(result, dict)
        assert "users" in result or "total" in result
        logger.info("get_memory_users result: %s", result)

    # -- 20. delete_memory (handled by fixture, but verify it works) --

    def test_20_delete_memory(self, client: MemoryCloudClient, memory_id: str):
        """
        Verify delete_memory works by creating a separate memory and deleting it.
        The main test memory is cleaned up by the fixture.
        """
        # Create a throwaway memory just to test delete
        throwaway = client.create_memory({
            "name": f"SDK Delete Test {datetime.now().isoformat()}",
            "custom_type": "universal",
            "config": {"vector_dim": 768},
            "owner_id": "sdk-functest-user",
        })
        throwaway_id = throwaway["id"]
        assert throwaway_id

        # Delete it
        delete_result = client.delete_memory(throwaway_id)
        assert isinstance(delete_result, dict)
        logger.info("delete_memory succeeded for %s", throwaway_id)

        # Verify it's gone
        with pytest.raises(MemoryCloudError) as exc_info:
            client.get_memory(throwaway_id)
        assert exc_info.value.status_code in (404, 410)
