from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from memory_cloud import quickstart as quickstart_module


class _FakeInterceptor:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.wrapped = None

    def wrap_openai(self, client):
        self.wrapped = client


def test_bootstrap_reuses_provided_memory_and_clients(monkeypatch):
    monkeypatch.setattr(quickstart_module, "AwarenessInterceptor", _FakeInterceptor)

    memory_client = MagicMock()
    openai_client = SimpleNamespace()

    session = quickstart_module.bootstrap_openai_injected_session(
        memory_id="mem-1",
        memory_client=memory_client,
        openai_client=openai_client,
        user_id="u-1",
        agent_role="assistant",
    )

    memory_client.create_memory.assert_not_called()
    assert session.memory_id == "mem-1"
    assert session.memory_client is memory_client
    assert session.openai_client is openai_client
    assert isinstance(session.interceptor, _FakeInterceptor)
    assert session.interceptor.wrapped is openai_client


def test_bootstrap_creates_memory_when_missing_id(monkeypatch):
    monkeypatch.setattr(quickstart_module, "AwarenessInterceptor", _FakeInterceptor)

    memory_client = MagicMock()
    memory_client.create_memory.return_value = {"id": "mem-created"}
    openai_client = SimpleNamespace()

    session = quickstart_module.bootstrap_openai_injected_session(
        owner_id="owner-1",
        memory_client=memory_client,
        openai_client=openai_client,
        source="sdk-test",
    )

    assert session.memory_id == "mem-created"
    memory_client.create_memory.assert_called_once()
    payload = memory_client.create_memory.call_args[0][0]
    assert payload["owner_id"] == "owner-1"
    assert payload["custom_type"] == "universal"
    assert payload["config"]["default_source"] == "sdk-test"


def test_bootstrap_requires_owner_when_memory_id_missing(monkeypatch):
    monkeypatch.setattr(quickstart_module, "AwarenessInterceptor", _FakeInterceptor)
    monkeypatch.delenv("AWARENESS_OWNER_ID", raising=False)
    monkeypatch.delenv("SDK_DEMO_USER_ID", raising=False)
    monkeypatch.delenv("USER", raising=False)

    with pytest.raises(ValueError, match="owner_id"):
        quickstart_module.bootstrap_openai_injected_session(
            memory_client=MagicMock(),
            openai_client=SimpleNamespace(),
            memory_id=None,
            owner_id=None,
            user_id=None,
        )
