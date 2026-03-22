"""Unit tests for MemoryCloudClient chat(), chat_stream(), and record() methods.

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
# Chat
# ------------------------------------------------------------------


class TestChat:
    def test_chat_sends_post_with_query(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"answer": "hello"}, "trace-chat"

        client._request = fake_request

        result = client.chat("mem-1", query="What is auth?")
        assert captured["method"] == "POST"
        assert "/memories/mem-1/chat" in captured["path"]
        assert captured["json_payload"]["query"] == "What is auth?"
        assert captured["json_payload"]["stream"] is False
        assert result["answer"] == "hello"

    def test_chat_with_all_params(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"answer": "detailed"}, "trace-all"

        client._request = fake_request

        result = client.chat(
            "mem-1",
            query="Explain auth",
            model="gpt-4",
            session_id="sess-42",
            metadata_filter={"user_id": "u-1"},
            context_budget_tokens=2000,
        )
        payload = captured["json_payload"]
        assert payload["model"] == "gpt-4"
        assert payload["session_id"] == "sess-42"
        assert payload["metadata_filter"] == {"user_id": "u-1"}
        assert payload["context_budget_tokens"] == 2000
        assert result["answer"] == "detailed"

    def test_chat_propagates_trace_id(self):
        client = _make_client()
        captured = {}

        def fake_request(**kwargs):
            captured.update(kwargs)
            return {"answer": "traced"}, "trace-abc"

        client._request = fake_request

        result = client.chat("mem-1", query="test", trace_id="trace-abc")
        assert captured["trace_id"] == "trace-abc"
        assert result.get("trace_id") == "trace-abc"


# ------------------------------------------------------------------
# Chat Stream
# ------------------------------------------------------------------


class TestChatStream:
    def test_chat_stream_sends_post_with_stream_true(self):
        client = _make_client()
        captured = {}

        mock_resp = MagicMock()
        mock_resp.iter_lines.return_value = []
        mock_resp.close = MagicMock()
        mock_resp.headers = {"X-Trace-Id": "trace-stream"}

        def fake_request_response(**kwargs):
            captured.update(kwargs)
            return mock_resp, "trace-stream"

        client._request_response = fake_request_response

        # Consume the generator
        list(client.chat_stream("mem-1", query="hello"))

        assert captured["method"] == "POST"
        assert "/memories/mem-1/chat" in captured["path"]
        assert captured["json_payload"]["stream"] is True
        assert captured["stream"] is True
        mock_resp.close.assert_called_once()

    def test_chat_stream_yields_parsed_sse_events(self):
        client = _make_client()

        mock_resp = MagicMock()
        mock_resp.iter_lines.return_value = [
            '{"text": "hello"}',
            "",
            '{"text": " world"}',
        ]
        mock_resp.close = MagicMock()
        mock_resp.headers = {"X-Trace-Id": "trace-sse"}

        def fake_request_response(**kwargs):
            return mock_resp, "trace-sse"

        client._request_response = fake_request_response

        events = list(client.chat_stream("mem-1", query="greet"))

        # Empty lines are skipped
        assert len(events) == 2
        assert events[0]["text"] == "hello"
        assert events[1]["text"] == " world"

    def test_chat_stream_with_all_params(self):
        client = _make_client()
        captured = {}

        mock_resp = MagicMock()
        mock_resp.iter_lines.return_value = ['{"text": "ok"}']
        mock_resp.close = MagicMock()
        mock_resp.headers = {"X-Trace-Id": "trace-all"}

        def fake_request_response(**kwargs):
            captured.update(kwargs)
            return mock_resp, "trace-all"

        client._request_response = fake_request_response

        events = list(client.chat_stream(
            "mem-1",
            query="full params",
            model="gpt-4",
            session_id="sess-99",
            metadata_filter={"agent_role": "builder"},
            context_budget_tokens=4000,
            trace_id="trace-full",
        ))

        payload = captured["json_payload"]
        assert payload["model"] == "gpt-4"
        assert payload["session_id"] == "sess-99"
        assert payload["metadata_filter"] == {"agent_role": "builder"}
        assert payload["context_budget_tokens"] == 4000
        assert captured["trace_id"] == "trace-full"
        assert len(events) == 1


# ------------------------------------------------------------------
# Record
# ------------------------------------------------------------------


class TestRecord:
    def test_record_string_content(self):
        """String content should be converted into an events list and ingested."""
        client = _make_client()

        ingest_captured = {}
        original_ingest = client.ingest_events

        def mock_ingest(memory_id, events, **kwargs):
            ingest_captured["memory_id"] = memory_id
            ingest_captured["events"] = events
            ingest_captured["kwargs"] = kwargs
            return {"ingested": len(events)}

        client.ingest_events = mock_ingest

        result = client.record("mem-1", content="user said hello")

        assert result["memory_id"] == "mem-1"
        assert result["events_sent"] == 1
        assert ingest_captured["memory_id"] == "mem-1"
        assert len(ingest_captured["events"]) == 1
        assert ingest_captured["events"][0]["content"] == "user said hello"

    def test_record_list_content(self):
        """List content should be ingested as multiple events."""
        client = _make_client()

        ingest_captured = {}

        def mock_ingest(memory_id, events, **kwargs):
            ingest_captured["events"] = events
            return {"ingested": len(events)}

        client.ingest_events = mock_ingest

        result = client.record("mem-1", content=["msg one", "msg two", "msg three"])

        assert result["events_sent"] == 3
        assert len(ingest_captured["events"]) == 3

    def test_record_dict_content(self):
        """Dict content should be normalized into a single event."""
        client = _make_client()

        ingest_captured = {}

        def mock_ingest(memory_id, events, **kwargs):
            ingest_captured["events"] = events
            return {"ingested": len(events)}

        client.ingest_events = mock_ingest

        result = client.record("mem-1", content={"content": "decision made", "event_type": "decision"})

        assert result["events_sent"] == 1
        assert ingest_captured["events"][0]["content"] == "decision made"

    def test_record_with_insights(self):
        """When insights are provided, _submit_insights should be called."""
        client = _make_client()

        # Mock ingest_events to no-op (no content provided)
        submit_captured = {}

        def mock_submit(memory_id, insights, **kwargs):
            submit_captured["memory_id"] = memory_id
            submit_captured["insights"] = insights
            submit_captured["kwargs"] = kwargs
            return {"stored": 1}

        client._submit_insights = mock_submit

        insights_data = {
            "knowledge_cards": [{"title": "Auth pattern", "summary": "JWT used"}],
            "risks": [],
            "action_items": [],
        }
        result = client.record("mem-1", insights=insights_data)

        assert submit_captured["memory_id"] == "mem-1"
        assert len(submit_captured["insights"]["knowledge_cards"]) == 1
        assert result["insights"]["stored"] == 1

    def test_record_with_scope_and_user_id_and_agent_role(self):
        """Verify scope, user_id, and agent_role are propagated to ingest_events."""
        client = _make_client()

        ingest_captured = {}

        def mock_ingest(memory_id, events, **kwargs):
            ingest_captured["events"] = events
            ingest_captured["kwargs"] = kwargs
            return {"ingested": 1}

        client.ingest_events = mock_ingest

        result = client.record(
            "mem-1",
            content="knowledge item",
            scope="knowledge",
            user_id="u-42",
            agent_role="researcher",
        )

        # scope="knowledge" sets aw_content_scope metadata
        assert ingest_captured["kwargs"].get("metadata_defaults") == {"aw_content_scope": "knowledge"}
        # user_id and agent_role are passed through
        assert ingest_captured["kwargs"].get("user_id") == "u-42"
        assert ingest_captured["kwargs"].get("agent_role") == "researcher"
        assert result["source"] is not None
