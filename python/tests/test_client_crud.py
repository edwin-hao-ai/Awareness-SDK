"""Unit tests for MemoryCloudClient core CRUD and content operations.

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
# Memory CRUD
# ------------------------------------------------------------------


class TestCreateMemory:
    def test_create_memory_sends_post(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"id": "mem-1", "name": "Test"})
        )

        result = client.create_memory({"name": "Test", "owner_id": "user-1"})

        call_kwargs = client.session.request.call_args
        assert call_kwargs[1]["method"] == "POST"
        assert "/memories" in call_kwargs[1]["url"]
        assert result["id"] == "mem-1"

    def test_create_memory_propagates_trace_id(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"id": "mem-1"}, headers={"X-Trace-Id": "trace-abc"})
        )

        result = client.create_memory({"name": "Test"}, trace_id="trace-abc")
        assert result.get("trace_id") == "trace-abc"


class TestListMemories:
    def test_list_memories_returns_list(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response([{"id": "m1"}, {"id": "m2"}])
        )

        result = client.list_memories()
        assert len(result) == 2
        assert result[0]["id"] == "m1"

    def test_list_memories_with_owner_filter(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response([{"id": "m1"}])
        )

        client.list_memories(owner_id="user-1")
        call_kwargs = client.session.request.call_args[1]
        assert "owner_id" in str(call_kwargs.get("params", {}))

    def test_list_memories_clamps_params(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response([])
        )

        client.list_memories(skip=-5, limit=0)
        call_kwargs = client.session.request.call_args[1]
        params = call_kwargs.get("params", {})
        assert params["skip"] >= 0
        assert params["limit"] >= 1


class TestGetMemory:
    def test_get_memory_by_id(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"id": "mem-1", "name": "Test Memory"})
        )

        result = client.get_memory("mem-1")
        call_kwargs = client.session.request.call_args[1]
        assert "/memories/mem-1" in call_kwargs["url"]
        assert result["name"] == "Test Memory"


class TestUpdateMemory:
    def test_update_memory_sends_patch(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"id": "mem-1", "name": "Updated"})
        )

        result = client.update_memory("mem-1", {"name": "Updated"})
        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "PATCH"
        assert result["name"] == "Updated"


class TestDeleteMemory:
    def test_delete_memory_sends_delete(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"deleted": True})
        )

        result = client.delete_memory("mem-1")
        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "DELETE"
        assert result["deleted"] is True


# ------------------------------------------------------------------
# Content Operations
# ------------------------------------------------------------------


class TestListMemoryContent:
    def test_list_content_returns_list(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response([{"id": "c1", "content": "hello"}])
        )

        result = client.list_memory_content("mem-1")
        assert len(result) == 1
        assert result[0]["id"] == "c1"


class TestWrite:
    def test_write_sends_post_with_content(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"status": "ok", "id": "vec-1"})
        )

        result = client.write("mem-1", "important note")
        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "POST"
        body = json.loads(call_kwargs["data"]) if "data" in call_kwargs else call_kwargs.get("json", {})
        assert result["status"] == "ok"


class TestDeleteMemoryContent:
    def test_delete_content(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"deleted": True})
        )

        result = client.delete_memory_content("mem-1", "c-1")
        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "DELETE"
        assert "/content/c-1" in call_kwargs["url"]


# ------------------------------------------------------------------
# Timeline
# ------------------------------------------------------------------


class TestMemoryTimeline:
    def test_timeline_get_request(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"events": [{"type": "message"}], "total": 1})
        )

        result = client.memory_timeline("mem-1", limit=50)
        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "GET"
        assert "/timeline" in call_kwargs["url"]
        assert result["total"] == 1

    def test_timeline_with_session_filter(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"events": [], "total": 0})
        )

        client.memory_timeline("mem-1", session_id="sess-1")
        call_kwargs = client.session.request.call_args[1]
        assert "sess-1" in str(call_kwargs.get("params", {}))


# ------------------------------------------------------------------
# Retrieve (advanced params)
# ------------------------------------------------------------------


class TestRetrieveAdvanced:
    def test_retrieve_multi_level(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"results": []}, "trace-adv"

        client._request = fake_request

        client.retrieve(memory_id="m1", query="auth flow", multi_level=True)
        assert captured["json_payload"]["multi_level"] is True

    def test_retrieve_cluster_expand(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"results": []}, "trace-adv"

        client._request = fake_request

        client.retrieve(memory_id="m1", query="auth flow", cluster_expand=True)
        assert captured["json_payload"]["cluster_expand"] is True

    def test_retrieve_include_installed(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"results": []}, "trace-adv"

        client._request = fake_request

        client.retrieve(memory_id="m1", query="search", include_installed=True)
        assert captured["json_payload"]["include_installed"] is True

    def test_retrieve_scope_knowledge_sets_metadata_filter(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"results": []}, "trace-scope"

        client._request = fake_request

        client.retrieve(memory_id="m1", query="docs", scope="knowledge")
        mf = captured["json_payload"]["metadata_filter"]
        assert mf["aw_content_scope"] == ["knowledge", "full_source"]

    def test_retrieve_user_id_and_agent_role(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"results": []}, "trace-filter"

        client._request = fake_request

        client.retrieve(memory_id="m1", query="test", user_id="u-1", agent_role="builder")
        body = captured["json_payload"]
        assert body["user_id"] == "u-1"
        assert body["agent_role"] == "builder"


# ------------------------------------------------------------------
# Ingest Events
# ------------------------------------------------------------------


class TestIngestEvents:
    def test_ingest_events_sends_post(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({"ingested": 3})
        )

        events = [
            {"content": "msg1", "event_type": "message"},
            {"content": "msg2", "event_type": "message"},
            {"content": "msg3", "event_type": "decision"},
        ]
        result = client.ingest_events("mem-1", events)
        call_kwargs = client.session.request.call_args[1]
        assert call_kwargs["method"] == "POST"
        assert result["ingested"] == 3


# ------------------------------------------------------------------
# Session Management
# ------------------------------------------------------------------


class TestSessionManagement:
    def test_begin_memory_session_returns_local_session(self):
        # begin_memory_session is local — does NOT make HTTP calls
        client = _make_client()
        result = client.begin_memory_session("mem-1", source="test")
        assert result["memory_id"] == "mem-1"
        assert result["source"] == "test"
        assert "session_id" in result
        assert len(result["session_id"]) > 0

    def test_begin_memory_session_uses_provided_id(self):
        client = _make_client()
        result = client.begin_memory_session("mem-1", session_id="my-sess")
        assert result["session_id"] == "my-sess"

    def test_session_caching(self):
        client = _make_client()
        client.begin_memory_session("mem-1", source="test")
        assert "mem-1" in client._session_cache


# ------------------------------------------------------------------
# Insights
# ------------------------------------------------------------------


class TestInsights:
    def test_insights_query(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({
                "knowledge_cards": [{"title": "JWT auth"}],
                "risks": [],
                "action_items": [],
            })
        )

        result = client.insights("mem-1", query="auth")
        assert len(result["knowledge_cards"]) == 1

    def test_submit_insights(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"stored": 2}, "trace-submit"

        client._request = fake_request

        insights = {
            "knowledge_cards": [{"title": "test", "summary": "test card"}],
            "risks": [],
            "action_items": [],
        }
        result = client.submit_insights("mem-1", insights, user_id="u-1", agent_role="builder")
        body = captured["json_payload"]
        assert body["user_id"] == "u-1"
        assert body["agent_role"] == "builder"
        assert "/insights/submit" in captured["path"]


# ------------------------------------------------------------------
# Context & Knowledge Base
# ------------------------------------------------------------------


class TestContextAndKnowledge:
    def test_get_session_context(self):
        client = _make_client()
        client.session = MagicMock()
        client.session.request = MagicMock(
            return_value=_mock_response({
                "memory_id": "mem-1",
                "recent_days": [],
                "open_tasks": [],
                "knowledge_cards": [],
            })
        )

        result = client.get_session_context("mem-1", days=3)
        assert result["memory_id"] == "mem-1"

    def test_get_knowledge_base(self):
        client = _make_client()
        client.session = MagicMock()
        # Server returns cards array; client re-counts total locally
        client.session.request = MagicMock(
            return_value=_mock_response({"cards": [{"title": "card1"}, {"title": "card2"}]})
        )

        result = client.get_knowledge_base("mem-1", category="decision")
        assert result["total"] == 2
        assert len(result["cards"]) == 2


# ------------------------------------------------------------------
# Retry Logic
# ------------------------------------------------------------------


class TestRetryLogic:
    def test_retry_on_429(self):
        client = _make_client(max_retries=2, backoff_seconds=0.01)
        fail_resp = MagicMock()
        fail_resp.status_code = 429
        fail_resp.headers = {}
        fail_resp.text = "rate limited"

        success_resp = _mock_response({"ok": True})

        client.session = MagicMock()
        client.session.request = MagicMock(side_effect=[fail_resp, success_resp])

        result = client.get_memory("mem-1")
        assert client.session.request.call_count == 2
        assert result["ok"] is True

    def test_retry_on_502(self):
        client = _make_client(max_retries=2, backoff_seconds=0.01)
        fail_resp = MagicMock()
        fail_resp.status_code = 502
        fail_resp.headers = {}
        fail_resp.text = "bad gateway"

        success_resp = _mock_response({"ok": True})

        client.session = MagicMock()
        client.session.request = MagicMock(side_effect=[fail_resp, success_resp])

        result = client.get_memory("mem-1")
        assert result["ok"] is True

    def test_no_retry_on_400(self):
        client = _make_client(max_retries=2, backoff_seconds=0.01)
        fail_resp = MagicMock()
        fail_resp.status_code = 400
        fail_resp.headers = {}
        fail_resp.text = '{"error": "bad request"}'
        fail_resp.json.return_value = {"error": "bad request"}

        client.session = MagicMock()
        client.session.request = MagicMock(return_value=fail_resp)

        with pytest.raises(Exception):
            client.get_memory("mem-1")

        # Should NOT retry on 400
        assert client.session.request.call_count == 1
