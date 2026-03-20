"""Unit tests for MemoryCloudClient task, agent, user, and rerank operations.

All tests use mock HTTP responses — no live server required.
"""

import json
from unittest.mock import MagicMock, patch

import pytest

from memory_cloud.client import MemoryCloudClient


def _make_client(**kwargs):
    defaults = dict(base_url="http://localhost:8000/api/v1", api_key="test-key")
    defaults.update(kwargs)
    return MemoryCloudClient(**defaults)


def _mock_response(json_data, status_code=200, headers=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = headers or {"X-Trace-Id": "trace-test"}
    resp.json.return_value = json_data
    resp.text = json.dumps(json_data)
    resp.raise_for_status = MagicMock()
    return resp


# ------------------------------------------------------------------
# Get Pending Tasks
# ------------------------------------------------------------------


class TestGetPendingTasks:
    def test_get_pending_tasks_sends_get(self):
        client = _make_client()
        calls = []

        def fake_request(**kwargs):
            calls.append(kwargs)
            return {"action_items": [{"title": "Fix bug", "priority": "high", "status": "pending"}]}, "trace-tasks"

        client._request = fake_request

        result = client.get_pending_tasks("mem-1", priority="high", limit=10)

        # Should make two calls: one for pending, one for in_progress
        assert len(calls) == 2
        assert calls[0]["method"] == "GET"
        assert "/insights/action-items" in calls[0]["path"]
        assert calls[0]["params"]["priority"] == "high"
        assert calls[0]["params"]["limit"] == 10
        assert calls[0]["params"]["status"] == "pending"
        assert calls[1]["params"]["status"] == "in_progress"
        assert "tasks" in result
        assert result["total"] >= 0

    def test_get_pending_tasks_with_user_id(self):
        client = _make_client()
        calls = []

        def fake_request(**kwargs):
            calls.append(kwargs)
            return {"action_items": []}, "trace-tasks-uid"

        client._request = fake_request

        client.get_pending_tasks("mem-1", user_id="user-42")

        # Both calls should include user_id
        assert calls[0]["params"]["user_id"] == "user-42"
        assert calls[1]["params"]["user_id"] == "user-42"


# ------------------------------------------------------------------
# Get Handoff Context
# ------------------------------------------------------------------


class TestGetHandoffContext:
    def test_get_handoff_context_sends_get(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {
                "recent_days": [],
                "open_tasks": [],
                "knowledge_cards": [],
            }, "trace-handoff"

        client._request = fake_request

        result = client.get_handoff_context("mem-1")

        assert captured["method"] == "GET"
        assert "/context" in captured["path"]
        assert captured["params"]["days"] == 3
        assert "memory_id" in result
        assert "recent_progress" in result
        assert "open_tasks" in result
        assert "key_knowledge" in result
        assert "token_estimate" in result

    def test_get_handoff_context_with_current_task(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {
                "recent_days": [],
                "open_tasks": [],
                "knowledge_cards": [],
            }, "trace-handoff-task"

        client._request = fake_request

        result = client.get_handoff_context("mem-1", current_task="Implement auth")

        assert result["briefing_for"] == "Implement auth"


# ------------------------------------------------------------------
# Get Session History
# ------------------------------------------------------------------


class TestGetSessionHistory:
    def test_get_session_history_sends_get(self):
        client = _make_client()
        captured = {}

        def fake_request_any(**kwargs):
            captured.update(kwargs)
            return [
                {"content": "event1", "aw_time_iso": "2026-01-01T00:00:00Z"},
                {"content": "event2", "aw_time_iso": "2026-01-01T00:01:00Z"},
            ], "trace-hist"

        client._request_any = fake_request_any

        result = client.get_session_history("mem-1", "sess-abc")

        assert captured["method"] == "GET"
        assert "/memories/mem-1/content" in captured["path"]
        assert captured["params"]["session_id"] == "sess-abc"
        assert result["session_id"] == "sess-abc"
        assert result["event_count"] == 2

    def test_get_session_history_with_user_id(self):
        client = _make_client()
        captured = {}

        def fake_request_any(**kwargs):
            captured.update(kwargs)
            return [], "trace-hist-uid"

        client._request_any = fake_request_any

        client.get_session_history("mem-1", "sess-abc", user_id="user-7")

        assert captured["params"]["user_id"] == "user-7"


# ------------------------------------------------------------------
# Update Task Status
# ------------------------------------------------------------------


class TestUpdateTaskStatus:
    def test_update_task_status_sends_patch(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"id": "task-1", "status": "completed"}, "trace-update"

        client._request = fake_request

        result = client.update_task_status("mem-1", "task-1", "completed")

        assert captured["method"] == "PATCH"
        assert "/insights/action-items/task-1" in captured["path"]
        assert result["status"] == "completed"

    def test_update_task_status_body(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"id": "task-2", "status": "in_progress"}, "trace-body"

        client._request = fake_request

        client.update_task_status("mem-1", "task-2", "in_progress")

        assert captured["json_payload"]["status"] == "in_progress"


# ------------------------------------------------------------------
# Detect Agent Role
# ------------------------------------------------------------------


class TestDetectAgentRole:
    def test_detect_agent_role_sends_post(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"detected_role": "backend", "confidence": 0.9}, "trace-detect"

        client._request = fake_request

        result = client.detect_agent_role("mem-1", "Fix the database migration")

        assert captured["method"] == "POST"
        assert "/detect-role" in captured["path"]
        assert result["detected_role"] == "backend"

    def test_detect_agent_role_body(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"detected_role": "frontend"}, "trace-detect-body"

        client._request = fake_request

        client.detect_agent_role("mem-1", "Update the React component styles")

        assert captured["json_payload"]["query"] == "Update the React component styles"


# ------------------------------------------------------------------
# List Agents
# ------------------------------------------------------------------


class TestListAgents:
    def test_list_agents_sends_get(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {
                "agents": [
                    {"agent_role": "backend", "name": "Backend Dev"},
                    {"agent_role": "frontend", "name": "Frontend Dev"},
                ],
                "total": 2,
            }, "trace-agents"

        client._request = fake_request

        result = client.list_agents("mem-1")

        assert captured["method"] == "GET"
        assert "/agents" in captured["path"]
        assert result["total"] == 2
        assert len(result["agents"]) == 2


# ------------------------------------------------------------------
# Get Agent Prompt
# ------------------------------------------------------------------


class TestGetAgentPrompt:
    def test_get_agent_prompt_sends_get(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {
                "agents": [
                    {
                        "agent_role": "backend",
                        "activation_prompt": "You are a backend developer.",
                    },
                    {
                        "agent_role": "frontend",
                        "activation_prompt": "You are a frontend developer.",
                    },
                ],
                "total": 2,
            }, "trace-prompt"

        client._request = fake_request

        result = client.get_agent_prompt("mem-1", "backend")

        # get_agent_prompt calls list_agents internally
        assert captured["method"] == "GET"
        assert "/agents" in captured["path"]
        assert result == "You are a backend developer."

    def test_get_agent_prompt_returns_none_for_missing_role(self):
        client = _make_client()

        def fake_request(**kwargs):
            return {"agents": [{"agent_role": "backend", "activation_prompt": "..."}], "total": 1}, "trace-miss"

        client._request = fake_request

        result = client.get_agent_prompt("mem-1", "nonexistent-role")
        assert result is None


# ------------------------------------------------------------------
# Get Memory Users
# ------------------------------------------------------------------


class TestGetMemoryUsers:
    def test_get_memory_users_sends_get(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"users": ["alice", "bob"], "total": 2}, "trace-users"

        client._request = fake_request

        result = client.get_memory_users("mem-1")

        assert captured["method"] == "GET"
        assert "/users" in captured["path"]
        assert result["total"] == 2

    def test_get_memory_users_with_pagination(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"users": ["carol"], "total": 3}, "trace-users-page"

        client._request = fake_request

        client.get_memory_users("mem-1", limit=10, offset=20)

        assert captured["params"]["limit"] == 10
        assert captured["params"]["offset"] == 20


# ------------------------------------------------------------------
# Rerank
# ------------------------------------------------------------------


class TestRerank:
    def test_rerank_sends_post(self):
        """Rerank uses the client-side extraction LLM, not an HTTP request.
        Verify it calls the LLM and returns reordered results."""
        client = _make_client()
        # Mock the extraction LLM
        mock_llm = MagicMock()
        client._extraction_llm = mock_llm
        client._llm_type = "openai"

        # Simulate LLM returning reordered indices
        mock_choice = MagicMock()
        mock_choice.message.content = "[1, 0]"
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        mock_llm.chat.completions.create.return_value = mock_response

        results = [
            {"content": "First result about auth"},
            {"content": "Second result about database"},
        ]

        reranked = client.rerank("database query", results, top_k=2)

        # LLM was called
        mock_llm.chat.completions.create.assert_called_once()
        # Results should be reordered: index 1 first, index 0 second
        assert len(reranked) == 2
        assert reranked[0]["content"] == "Second result about database"
        assert reranked[1]["content"] == "First result about auth"
        assert reranked[0]["_rerank_position"] == 1
        assert reranked[1]["_rerank_position"] == 0

    def test_rerank_returns_results(self):
        """When no extraction LLM is configured, rerank returns original order."""
        client = _make_client()
        # No extraction LLM configured (default)
        assert client._extraction_llm is None

        results = [
            {"content": "Alpha"},
            {"content": "Beta"},
            {"content": "Gamma"},
        ]

        reranked = client.rerank("test query", results, top_k=2)

        # Should return first top_k items in original order
        assert len(reranked) == 2
        assert reranked[0]["content"] == "Alpha"
        assert reranked[1]["content"] == "Beta"
