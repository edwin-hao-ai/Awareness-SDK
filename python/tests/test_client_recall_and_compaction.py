from memory_cloud.client import MemoryCloudClient
from memory_cloud.integrations._base import _compact_events_for_extraction as compact_adapter_events
from memory_cloud.interceptor import _compact_events_for_extraction as compact_interceptor_events


def test_compact_events_respects_limits_for_interceptor_and_adapter():
    events = [
        {"content": "   "},
        {"content": "A" * 12},
        {"content": "B" * 12},
        {"content": "C" * 12},
    ]

    for fn in (compact_interceptor_events, compact_adapter_events):
        compacted = fn(
            events,
            max_events=4,
            max_chars_per_event=6,
            max_total_chars=15,
        )
        assert compacted == ["AAAAAA", "BBBBBB"]


def test_recall_for_task_builds_query_and_clamps_limit():
    client = MemoryCloudClient(
        base_url="http://localhost:8000/api/v1",
        api_key="test-key",
    )
    client._session_cache["memory-1"] = "sess-cached"  # type: ignore[attr-defined]

    captured = {}

    def fake_retrieve(**kwargs):
        captured.update(kwargs)
        return {"results": [{"content": "context hit"}], "trace_id": "trace-recall"}

    client.retrieve = fake_retrieve  # type: ignore[method-assign]

    result = client.recall_for_task(
        memory_id="memory-1",
        task="Summarize latest auth changes",
        limit=999,
        source="sdk demo",
        use_hybrid_search=False,
        use_mmr=True,
        mmr_lambda=0.2,
        recall_mode="hybrid",
        scope="knowledge",
        metadata_filter={"project": "alpha"},
        user_id="u-1",
        agent_role="builder",
    )

    assert captured["limit"] == 30
    assert captured["use_hybrid_search"] is False
    assert captured["use_mmr"] is True
    assert captured["mmr_lambda"] == 0.2
    assert captured["recall_mode"] == "hybrid"
    assert captured["scope"] == "knowledge"
    assert captured["metadata_filter"] == {"project": "alpha"}
    assert captured["user_id"] == "u-1"
    assert captured["agent_role"] == "builder"
    assert "Summarize latest auth changes" in captured["query"]
    assert "remaining todos, and blockers" in captured["query"]

    assert result["memory_id"] == "memory-1"
    assert result["session_id"] == "sess-cached"
    assert result["trace_id"] == "trace-recall"
    assert len(result["results"]) == 1


def test_retrieve_defaults_to_precise_and_auto_extracts_keywords():
    client = MemoryCloudClient(
        base_url="http://localhost:8000/api/v1",
        api_key="test-key",
    )

    captured = {}

    def fake_request(**kwargs):
        captured.update(kwargs)
        return {"results": []}, "trace-retrieve"

    client._request = fake_request  # type: ignore[method-assign]
    result = client.retrieve(memory_id="memory-1", query='Check auth.py around "JWT" refresh flow')

    assert result["trace_id"] == "trace-retrieve"
    body = captured["json_payload"]
    assert body["recall_mode"] == "precise"
    assert body["custom_kwargs"]["recall_mode"] == "precise"
    assert "auth.py" in body["keyword_query"]


def test_recall_for_task_defaults_to_hybrid():
    client = MemoryCloudClient(
        base_url="http://localhost:8000/api/v1",
        api_key="test-key",
    )
    client._session_cache["memory-1"] = "sess-cached"  # type: ignore[attr-defined]

    captured = {}

    def fake_retrieve(**kwargs):
        captured.update(kwargs)
        return {"results": []}

    client.retrieve = fake_retrieve  # type: ignore[method-assign]
    client.recall_for_task(memory_id="memory-1", task="continue auth work")

    assert captured["recall_mode"] == "hybrid"
