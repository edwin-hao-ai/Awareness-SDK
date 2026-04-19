"""Tests for ``retrieve_with_hyde`` helper on the Python SDK.

Covers the four behaviours we care about:
  1. Happy path: LLM returns a sensible hypothetical answer → it is
     trimmed, clamped to 400 chars, and forwarded to ``retrieve`` as the
     ``hyde_hint`` kwarg.
  2. Fallback: ``llm_complete`` raises → the helper swallows the error
     and calls ``retrieve`` with ``hyde_hint=None``.
  3. Too-short output (<20 chars after strip) is dropped.
  4. Plain ``retrieve(hyde_hint="…")`` wires the value into the POST
     body so the new backend parameter is actually on the wire.
"""

from __future__ import annotations

from typing import Any, Dict

import pytest

from memory_cloud.client import MemoryCloudClient


def _make_client() -> MemoryCloudClient:
    return MemoryCloudClient(
        base_url="http://localhost:8000/api/v1",
        api_key="test-key",
    )


def test_retrieve_with_hyde_forwards_generated_hint() -> None:
    client = _make_client()

    captured: Dict[str, Any] = {}
    prompt_seen: Dict[str, str] = {}

    def llm_complete(prompt: str) -> str:
        prompt_seen["value"] = prompt
        return (
            "JWT refresh tokens live for 30 days, rotate on every use, "
            "and are stored hashed in users.refresh_token_hash."
        )

    def fake_retrieve(*args: Any, **kwargs: Any) -> Dict[str, Any]:
        # Support either positional or keyword passthrough
        if args:
            kwargs.setdefault("memory_id", args[0] if len(args) > 0 else None)
            kwargs.setdefault("query", args[1] if len(args) > 1 else None)
        captured.update(kwargs)
        return {"results": [{"content": "hit"}]}

    client.retrieve = fake_retrieve  # type: ignore[method-assign]

    out = client.retrieve_with_hyde(
        "memory-1",
        "How long do refresh tokens live?",
        llm_complete,
        limit=5,
    )

    assert out["results"] == [{"content": "hit"}]
    assert captured["memory_id"] == "memory-1"
    assert captured["query"] == "How long do refresh tokens live?"
    assert captured["limit"] == 5
    assert isinstance(captured["hyde_hint"], str)
    assert captured["hyde_hint"].startswith("JWT refresh tokens live")
    assert "hypothetical answer" in prompt_seen["value"]
    assert "How long do refresh tokens live?" in prompt_seen["value"]


def test_retrieve_with_hyde_falls_back_when_llm_raises() -> None:
    client = _make_client()
    captured: Dict[str, Any] = {}

    def llm_complete(_prompt: str) -> str:
        raise RuntimeError("LLM provider down")

    def fake_retrieve(*args: Any, **kwargs: Any) -> Dict[str, Any]:
        if args:
            kwargs.setdefault("memory_id", args[0] if len(args) > 0 else None)
            kwargs.setdefault("query", args[1] if len(args) > 1 else None)
        captured.update(kwargs)
        return {"results": []}

    client.retrieve = fake_retrieve  # type: ignore[method-assign]

    client.retrieve_with_hyde(
        "memory-2",
        "fallback query",
        llm_complete,
    )

    assert captured["query"] == "fallback query"
    assert captured["hyde_hint"] is None, (
        "When the user's LLM raises, we must fall back to plain retrieve "
        "with hyde_hint=None, not crash or silently send a partial hint."
    )


def test_retrieve_with_hyde_drops_too_short_output() -> None:
    client = _make_client()
    captured: Dict[str, Any] = {}

    def llm_complete(_prompt: str) -> str:
        return "too short"  # 9 chars < 20 threshold

    def fake_retrieve(*args: Any, **kwargs: Any) -> Dict[str, Any]:
        if args:
            kwargs.setdefault("memory_id", args[0] if len(args) > 0 else None)
            kwargs.setdefault("query", args[1] if len(args) > 1 else None)
        captured.update(kwargs)
        return {"results": []}

    client.retrieve = fake_retrieve  # type: ignore[method-assign]

    client.retrieve_with_hyde("memory-3", "short-output q", llm_complete)

    assert captured["hyde_hint"] is None


def test_retrieve_with_hyde_clamps_long_output() -> None:
    client = _make_client()
    captured: Dict[str, Any] = {}

    def llm_complete(_prompt: str) -> str:
        return "A" * 1200

    def fake_retrieve(*args: Any, **kwargs: Any) -> Dict[str, Any]:
        if args:
            kwargs.setdefault("memory_id", args[0] if len(args) > 0 else None)
            kwargs.setdefault("query", args[1] if len(args) > 1 else None)
        captured.update(kwargs)
        return {"results": []}

    client.retrieve = fake_retrieve  # type: ignore[method-assign]

    client.retrieve_with_hyde("memory-4", "clamp check", llm_complete)

    assert isinstance(captured["hyde_hint"], str)
    assert len(captured["hyde_hint"]) == 400


def test_retrieve_wires_hyde_hint_into_post_body() -> None:
    """Direct retrieve(hyde_hint=…) must forward the field on the wire."""
    client = _make_client()
    captured: Dict[str, Any] = {}

    def fake_request(
        *,
        method: str,
        path: str,
        json_payload: Any = None,
        trace_id: Any = None,
        **_: Any,
    ):
        captured["method"] = method
        captured["path"] = path
        captured["body"] = json_payload
        return ({"results": []}, trace_id or "trace-x")

    client._request = fake_request  # type: ignore[method-assign]

    client.retrieve(
        "memory-5",
        "explicit hint",
        hyde_hint="  A pre-computed hypothetical passage for the query.  ",
    )

    assert captured["method"] == "POST"
    assert captured["path"] == "/memories/memory-5/retrieve"
    assert (
        captured["body"]["hyde_hint"]
        == "A pre-computed hypothetical passage for the query."
    ), "Explicit hyde_hint must be trimmed and sent on the wire"


def test_retrieve_omits_hyde_hint_when_not_set() -> None:
    """Backward compat: callers who do not pass hyde_hint see no new field."""
    client = _make_client()
    captured: Dict[str, Any] = {}

    def fake_request(
        *,
        method: str,
        path: str,
        json_payload: Any = None,
        trace_id: Any = None,
        **_: Any,
    ):
        captured["body"] = json_payload
        return ({"results": []}, trace_id or "trace-y")

    client._request = fake_request  # type: ignore[method-assign]

    client.retrieve("memory-6", "no hint here")

    assert "hyde_hint" not in captured["body"]


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
