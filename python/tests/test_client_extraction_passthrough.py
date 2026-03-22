from unittest.mock import MagicMock

from memory_cloud.client import MemoryCloudClient


def _build_client() -> MemoryCloudClient:
    return MemoryCloudClient(base_url="http://localhost:8000/api/v1", api_key="test-key")


def test_record_single_content_passthrough_extraction_request():
    client = _build_client()
    client.ingest_events = MagicMock(  # type: ignore[method-assign]
        return_value={
            "accepted": 1,
            "written": 1,
            "extraction_request": {"memory_id": "m1", "session_id": "s1", "events": []},
            "trace_id": "trace-step",
        }
    )

    result = client.record(memory_id="m1", content="Implemented auth guard for admin API.")

    assert result.get("extraction_request") is not None
    assert result["extraction_request"]["session_id"] == "s1"
    assert result.get("trace_id") == "trace-step"


def test_record_batch_content_passthrough_extraction_request():
    client = _build_client()
    client.ingest_events = MagicMock(  # type: ignore[method-assign]
        return_value={
            "accepted": 3,
            "written": 3,
            "extraction_request": {"memory_id": "m2", "session_id": "s2", "events": []},
            "trace_id": "trace-batch",
        }
    )

    result = client.record(
        memory_id="m2",
        content=[
            "Completed migration patch for user aliases.",
            "Risk: API key owner mismatch can cause tenant leakage if unchecked.",
        ],
    )

    assert result.get("extraction_request") is not None
    assert result["extraction_request"]["session_id"] == "s2"
    assert result.get("trace_id") == "trace-batch"
