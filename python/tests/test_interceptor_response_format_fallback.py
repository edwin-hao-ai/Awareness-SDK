from types import SimpleNamespace
from unittest.mock import MagicMock

from memory_cloud.interceptor import (
    AwarenessInterceptor,
    _coerce_json_object_text,
    _parse_insights_payload,
)
from memory_cloud.integrations._base import _normalize_insights_payload


def _fake_openai_response(content: str):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content),
            )
        ]
    )


def test_openai_extraction_fallback_when_response_format_not_supported():
    client = MagicMock()
    client.begin_memory_session.return_value = {"session_id": "sess-1"}

    interceptor = AwarenessInterceptor(client=client, memory_id="m1")

    calls = {"count": 0}

    def fake_create(**kwargs):
        calls["count"] += 1
        if "response_format" in kwargs:
            raise RuntimeError("invalid_request_error: response_format is not supported")
        return _fake_openai_response('{"knowledge_cards":[],"risks":[],"action_items":[]}')

    interceptor._original_openai_create = fake_create  # type: ignore[assignment]

    text = interceptor._call_llm_for_extraction("system", "user")
    assert text.startswith("{")
    assert calls["count"] == 2


def test_coerce_json_object_text_from_markdown_block():
    raw = """```json
{
  "knowledge_cards": [],
  "risks": [],
  "action_items": []
}
```"""
    normalized = _coerce_json_object_text(raw)
    assert normalized.startswith("{")
    assert normalized.endswith("}")


def test_parse_insights_payload_accepts_python_literal_dict():
    text = "{'knowledge_cards': [], 'risks': [], 'action_items': []}"
    parsed = _parse_insights_payload(text)
    assert isinstance(parsed, dict)
    assert "knowledge_cards" in parsed


def test_parse_insights_payload_raises_value_error_on_unhashable_literal():
    bad = "{'knowledge_cards': {{'title': 't'}}, 'risks': [], 'action_items': []}"
    try:
        _parse_insights_payload(bad)
        raised = False
    except ValueError as exc:
        raised = "Invalid extraction payload" in str(exc)
    assert raised


def test_normalize_insights_payload_sanitizes_tags():
    payload = {
        "knowledge_cards": [
            {
                "title": "Idempotency decision",
                "summary": "Use idempotency keys on write endpoints.",
                "tags": [{"label": "idempotency"}, "webhook"],
            }
        ]
    }
    normalized = _normalize_insights_payload(payload)
    tags = normalized["knowledge_cards"][0]["tags"]
    assert tags == ["idempotency", "webhook"]
