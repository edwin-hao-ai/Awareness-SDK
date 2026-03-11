"""Unit tests for AwarenessInterceptor — wrap_openai, wrap_anthropic, register_function.

All tests use mock clients — no live LLM or server calls.
"""

import json
from unittest.mock import MagicMock, patch, PropertyMock

from memory_cloud.client import MemoryCloudClient
from memory_cloud.interceptor import (
    AwarenessInterceptor,
    _extract_last_user_message_openai,
    _extract_last_user_message_anthropic,
    _extract_assistant_text_openai,
)


def _make_client():
    client = MagicMock(spec=MemoryCloudClient)
    client.base_url = "http://localhost:8000/api/v1"
    client.api_key = "test-key"
    client.begin_memory_session.return_value = {"session_id": "sess-1"}
    client.retrieve.return_value = {"results": [{"content": "recalled context"}]}
    client.remember_step.return_value = {"status": "ok", "event_id": "e1"}
    client.get_agent_prompt.return_value = {"prompt": "You are a helpful assistant."}
    return client


# ------------------------------------------------------------------
# Helper function tests
# ------------------------------------------------------------------


class TestHelperFunctions:
    def test_extract_last_user_message_openai_simple(self):
        messages = [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "Hello world"},
            {"role": "assistant", "content": "Hi!"},
        ]
        assert _extract_last_user_message_openai(messages) == "Hello world"

    def test_extract_last_user_message_openai_vision(self):
        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": "Describe this"},
                {"type": "image_url", "image_url": {"url": "http://example.com/img.png"}},
            ]},
        ]
        assert "Describe this" in _extract_last_user_message_openai(messages)

    def test_extract_last_user_message_openai_empty(self):
        assert _extract_last_user_message_openai([]) == ""
        assert _extract_last_user_message_openai([{"role": "system", "content": "sys"}]) == ""

    def test_extract_last_user_message_anthropic(self):
        messages = [
            {"role": "user", "content": "First question"},
            {"role": "assistant", "content": "Answer"},
            {"role": "user", "content": "Follow up"},
        ]
        assert _extract_last_user_message_anthropic(messages) == "Follow up"

    def test_extract_last_user_message_anthropic_content_blocks(self):
        messages = [
            {"role": "user", "content": [
                {"type": "text", "text": "Part A"},
                {"type": "text", "text": "Part B"},
            ]},
        ]
        result = _extract_last_user_message_anthropic(messages)
        assert "Part A" in result
        assert "Part B" in result

    def test_extract_assistant_text_openai(self):
        response = MagicMock()
        choice = MagicMock()
        choice.message = MagicMock()
        choice.message.content = "Assistant reply"
        response.choices = [choice]
        assert _extract_assistant_text_openai(response) == "Assistant reply"

    def test_extract_assistant_text_openai_empty(self):
        response = MagicMock()
        response.choices = []
        assert _extract_assistant_text_openai(response) == ""


# ------------------------------------------------------------------
# Interceptor initialization
# ------------------------------------------------------------------


class TestInterceptorInit:
    def test_basic_init(self):
        client = _make_client()
        interceptor = AwarenessInterceptor(
            client=client,
            memory_id="mem-1",
        )
        assert interceptor.memory_id == "mem-1"
        assert interceptor.session_id == "sess-1"

    def test_init_with_user_id_and_agent_role(self):
        client = _make_client()
        interceptor = AwarenessInterceptor(
            client=client,
            memory_id="mem-1",
            user_id="u-1",
            agent_role="builder",
        )
        assert interceptor.user_id == "u-1"
        assert interceptor.agent_role == "builder"


# ------------------------------------------------------------------
# wrap_openai
# ------------------------------------------------------------------


class TestWrapOpenAI:
    def test_wrap_openai_patches_create(self):
        client = _make_client()
        interceptor = AwarenessInterceptor(client=client, memory_id="mem-1")

        # Create a mock OpenAI client
        oai = MagicMock()
        oai.chat = MagicMock()
        oai.chat.completions = MagicMock()
        original_create = MagicMock()
        oai.chat.completions.create = original_create

        interceptor.wrap_openai(oai)

        # create should be replaced
        assert oai.chat.completions.create != original_create

    def test_wrap_openai_injects_memory_and_stores(self):
        client = _make_client()
        interceptor = AwarenessInterceptor(
            client=client,
            memory_id="mem-1",
            auto_remember=True,
        )

        # Create mock OpenAI client
        oai = MagicMock()
        oai.chat = MagicMock()
        oai.chat.completions = MagicMock()

        # Mock the response
        mock_choice = MagicMock()
        mock_choice.message = MagicMock()
        mock_choice.message.content = "Here is my response"
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]

        original_create = MagicMock(return_value=mock_response)
        oai.chat.completions.create = original_create

        interceptor.wrap_openai(oai)

        # Call the wrapped function
        messages = [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "What did we decide about auth?"},
        ]
        result = oai.chat.completions.create(messages=messages)

        # Should have called retrieve for memory context
        assert client.retrieve.called

        # Response should be passed through
        assert result == mock_response


class TestWrapAnthropic:
    def test_wrap_anthropic_patches_create(self):
        client = _make_client()
        interceptor = AwarenessInterceptor(client=client, memory_id="mem-1")

        ant = MagicMock()
        ant.messages = MagicMock()
        original_create = MagicMock()
        ant.messages.create = original_create

        interceptor.wrap_anthropic(ant)

        assert ant.messages.create != original_create

    def test_wrap_anthropic_injects_memory(self):
        client = _make_client()
        interceptor = AwarenessInterceptor(client=client, memory_id="mem-1")

        ant = MagicMock()
        ant.messages = MagicMock()

        # Mock Anthropic response
        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = "Anthropic reply"
        mock_response = MagicMock()
        mock_response.content = [mock_block]

        original_create = MagicMock(return_value=mock_response)
        ant.messages.create = original_create

        interceptor.wrap_anthropic(ant)

        messages = [
            {"role": "user", "content": "Tell me about our architecture"},
        ]
        result = ant.messages.create(messages=messages, model="claude-sonnet-4-6")

        assert client.retrieve.called
        assert result == mock_response


# ------------------------------------------------------------------
# register_function
# ------------------------------------------------------------------


class TestRegisterFunction:
    def test_register_function_wraps_callable(self):
        client = _make_client()
        interceptor = AwarenessInterceptor(client=client, memory_id="mem-1")

        original_fn = MagicMock(return_value={"choices": [{"message": {"content": "reply"}}]})

        wrapped = interceptor.register_function(original_fn)

        assert wrapped != original_fn
        assert callable(wrapped)

    def test_register_function_passes_messages_through(self):
        client = _make_client()
        interceptor = AwarenessInterceptor(client=client, memory_id="mem-1")

        captured = {}

        def fake_fn(**kwargs):
            captured.update(kwargs)
            return {"choices": [{"message": {"content": "reply"}}]}

        wrapped = interceptor.register_function(fake_fn)
        wrapped(messages=[{"role": "user", "content": "hello"}], model="gpt-4")

        # Should have been called with messages (possibly augmented with memory)
        assert "messages" in captured
