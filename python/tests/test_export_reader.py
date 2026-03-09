import io
import json
import zipfile
import os

from memory_cloud import parse_jsonl_bytes, read_export_package_bytes
from memory_cloud.client import MemoryCloudClient


def test_parse_jsonl_bytes():
    payload = b'{"id":"1","chunk":"hello"}\n{"id":"2","chunk":"world"}\n'
    rows = parse_jsonl_bytes(payload)
    assert len(rows) == 2
    assert rows[0]["id"] == "1"


def test_read_export_package_bytes():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps({"version": "1.0", "export": {"package_type": "vector_only"}}))
        zf.writestr("vectors/vectors.jsonl", '{"id":"a","vector":[0.1,0.2]}\n')
        zf.writestr("chunks/raw_chunks.jsonl", '{"id":"a","chunk":"hello"}\n')
        zf.writestr("kv_cache/summary.json", json.dumps({"total_sessions": 1, "sessions": []}))
        zf.writestr("vectors/embeddings.safetensors", b"dummy")

    parsed = read_export_package_bytes(buffer.getvalue(), include_binary=True)
    assert parsed["manifest"]["version"] == "1.0"
    assert len(parsed["vectors_jsonl"]) == 1
    assert len(parsed["chunks"]) == 1
    assert parsed["kv_summary"]["total_sessions"] == 1
    assert parsed["safetensors"]["size"] == 5
    assert "vectors/embeddings.safetensors" in parsed["binary_files"]


def test_mcp_helper_session_and_history_parse():
    api_base = os.getenv("AWARENESS_API_BASE_URL", os.getenv("AWARENESS_BASE_URL", "http://localhost:8000/api/v1"))
    client = MemoryCloudClient(base_url=api_base, api_key="k")

    first = client.begin_memory_session(memory_id="m1", source="python-sdk")
    second = client.begin_memory_session(memory_id="m1", source="python-sdk")
    assert first["session_id"] != second["session_id"]

    backfilled = client._coerce_history_to_events(
        history="User: hi\nAssistant: done",
        source="python-sdk",
        session_id=second["session_id"],
    )
    assert len(backfilled) == 2
    assert backfilled[0]["session_id"] == second["session_id"]
