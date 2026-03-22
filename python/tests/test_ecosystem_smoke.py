"""Ecosystem smoke tests — verify that SDK adapters actually work with real framework imports.

These tests install the real framework packages and test that our adapters can:
1. Be imported alongside the real framework
2. Instantiate correctly with mock clients
3. Produce framework-native objects (LangChain Documents, CrewAI tools, etc.)
4. Handle the injection/wrap lifecycle without errors

No live API calls — all memory operations are mocked.
Frameworks that aren't installed are automatically skipped.
"""

import json
import sys
from unittest.mock import MagicMock

import pytest


def _mock_memory_client():
    """Create a mock MemoryCloudClient with sensible defaults."""
    client = MagicMock()
    client.base_url = "http://localhost:8000/api/v1"
    client.api_key = "test-key"
    client._begin_memory_session.return_value = {"session_id": "sess-smoke"}
    client.retrieve.return_value = {
        "results": [
            {"content": "We decided to use JWT for auth.", "id": "v1", "score": 0.92},
            {"content": "Redis is the session store.", "id": "v2", "score": 0.85},
        ]
    }
    client.record.return_value = {"status": "ok", "events_sent": 1}
    client.insights.return_value = {
        "knowledge_cards": [
            {"category": "decision", "title": "JWT Auth", "summary": "Use JWT tokens", "status": "noted"},
        ],
        "risks": [{"title": "Token expiry", "severity": "medium"}],
        "action_items": [{"title": "Implement refresh", "status": "open"}],
    }
    client.get_agent_prompt.return_value = {"prompt": "You are a helpful assistant."}
    return client


# ==================================================================
# LangChain Integration
# ==================================================================


langchain_available = pytest.mark.skipif(
    not any(m.startswith("langchain") for m in sys.modules)
    and pytest.importorskip("langchain_core", reason="langchain not installed") is None,
    reason="langchain not installed",
)


class TestLangChainEcosystem:
    """Test that our LangChain adapter produces real LangChain-compatible objects."""

    @pytest.fixture(autouse=True)
    def _skip_if_missing(self):
        pytest.importorskip("langchain_core", reason="langchain-core not installed")

    def test_as_retriever_returns_base_retriever(self):
        from langchain_core.retrievers import BaseRetriever
        from memory_cloud.integrations.langchain import MemoryCloudLangChain

        mc = MemoryCloudLangChain(client=_mock_memory_client(), memory_id="m1")
        retriever = mc.as_retriever()

        assert isinstance(retriever, BaseRetriever)

    def test_retriever_returns_documents(self):
        from langchain_core.documents import Document
        from memory_cloud.integrations.langchain import MemoryCloudLangChain

        mc = MemoryCloudLangChain(client=_mock_memory_client(), memory_id="m1")
        retriever = mc.as_retriever()

        docs = retriever._get_relevant_documents("auth decisions")
        assert len(docs) == 2
        assert all(isinstance(d, Document) for d in docs)
        assert "JWT" in docs[0].page_content

    def test_retrieve_documents_method(self):
        from langchain_core.documents import Document
        from memory_cloud.integrations.langchain import MemoryCloudLangChain

        mc = MemoryCloudLangChain(client=_mock_memory_client(), memory_id="m1")
        docs = mc.retrieve_documents("auth")

        assert len(docs) == 2
        assert all(isinstance(d, Document) for d in docs)

    def test_inject_into_messages_preserves_format(self):
        from memory_cloud.integrations.langchain import MemoryCloudLangChain

        mc = MemoryCloudLangChain(client=_mock_memory_client(), memory_id="m1")
        messages = [
            {"role": "system", "content": "You are an expert."},
            {"role": "user", "content": "What auth do we use?"},
        ]
        result = mc.inject_into_messages(messages)

        assert result[0]["role"] == "system"
        assert "[Relevant memories]" in result[0]["content"]
        assert "JWT" in result[0]["content"]
        # Original system content should be preserved
        assert "expert" in result[0]["content"]

    def test_tool_functions_are_callable(self):
        from memory_cloud.integrations.langchain import MemoryCloudLangChain

        mc = MemoryCloudLangChain(client=_mock_memory_client(), memory_id="m1")
        tools = mc.get_tool_functions()

        assert len(tools) == 3
        names = {t["name"] for t in tools}
        assert names == {"memory_search", "memory_write", "memory_insights"}

        # Verify search returns actual results (memory_search returns the results array directly)
        search_fn = next(t["callable"] for t in tools if t["name"] == "memory_search")
        result = search_fn("auth")
        parsed = json.loads(result)
        assert isinstance(parsed, list)
        assert len(parsed) == 2

    def test_memory_write_stores_event(self):
        from memory_cloud.integrations.langchain import MemoryCloudLangChain

        client = _mock_memory_client()
        mc = MemoryCloudLangChain(client=client, memory_id="m1", auto_remember=False)
        mc.memory_write("Important decision: use PostgreSQL")

        client.record.assert_called_once()

    def test_wrap_llm_openai(self):
        """Test that wrap_llm works with a mock OpenAI client."""
        from memory_cloud.integrations.langchain import MemoryCloudLangChain

        mc = MemoryCloudLangChain(client=_mock_memory_client(), memory_id="m1")

        oai = MagicMock()
        oai.chat = MagicMock()
        oai.chat.completions = MagicMock()

        mock_choice = MagicMock()
        mock_choice.message = MagicMock()
        mock_choice.message.content = "Use JWT"
        mock_response = MagicMock()
        mock_response.choices = [mock_choice]
        oai.chat.completions.create = MagicMock(return_value=mock_response)

        mc.wrap_llm(oai)

        result = oai.chat.completions.create(
            messages=[{"role": "user", "content": "What auth?"}],
            model="gpt-4",
        )
        assert result.choices[0].message.content == "Use JWT"


# ==================================================================
# CrewAI Integration
# ==================================================================


class TestCrewAIEcosystem:
    """Test CrewAI adapter produces valid tool definitions."""

    @pytest.fixture(autouse=True)
    def _skip_if_missing(self):
        pytest.importorskip("crewai_tools", reason="crewai-tools not installed")

    def test_tool_functions_structure(self):
        from memory_cloud.integrations.crewai import MemoryCloudCrewAI

        mc = MemoryCloudCrewAI(client=_mock_memory_client(), memory_id="m1")
        tools = mc.get_tool_functions()

        assert len(tools) == 3
        for tool in tools:
            assert "name" in tool
            assert "description" in tool
            assert "callable" in tool
            assert callable(tool["callable"])

    def test_inject_context_into_messages(self):
        from memory_cloud.integrations.crewai import MemoryCloudCrewAI

        mc = MemoryCloudCrewAI(client=_mock_memory_client(), memory_id="m1")
        messages = [
            {"role": "system", "content": "You are a crew member."},
            {"role": "user", "content": "What's our database?"},
        ]
        result = mc.inject_into_messages(messages)
        assert "[Relevant memories]" in result[0]["content"]

    def test_search_returns_json(self):
        from memory_cloud.integrations.crewai import MemoryCloudCrewAI

        mc = MemoryCloudCrewAI(client=_mock_memory_client(), memory_id="m1")
        result = mc.memory_search("database")
        parsed = json.loads(result)
        assert isinstance(parsed, list)
        assert len(parsed) == 2

    def test_insights_returns_structured(self):
        from memory_cloud.integrations.crewai import MemoryCloudCrewAI

        mc = MemoryCloudCrewAI(client=_mock_memory_client(), memory_id="m1")
        result = mc.memory_insights("auth")
        parsed = json.loads(result)
        assert "knowledge_cards" in parsed
        assert "risks" in parsed
        assert "action_items" in parsed


# ==================================================================
# AutoGen Integration
# ==================================================================


class TestAutoGenEcosystem:
    """Test AutoGen adapter hook injection and tool registration."""

    @pytest.fixture(autouse=True)
    def _skip_if_missing(self):
        # AutoGen may be installed as 'autogen-agentchat' or 'ag2'
        try:
            import autogen
        except ImportError:
            try:
                import ag2
            except ImportError:
                pytest.skip("autogen/ag2 not installed")

    def test_inject_into_agent_registers_hooks(self):
        from memory_cloud.integrations.autogen import MemoryCloudAutoGen

        mc = MemoryCloudAutoGen(client=_mock_memory_client(), memory_id="m1")

        agent = MagicMock()
        hooks = {}

        def fake_register(hook_name, fn):
            hooks[hook_name] = fn

        agent.register_hook = fake_register
        mc.inject_into_agent(agent)

        assert "process_all_messages_before_reply" in hooks
        assert "process_message_before_send" in hooks

    def test_pre_reply_hook_injects_memory(self):
        from memory_cloud.integrations.autogen import MemoryCloudAutoGen

        mc = MemoryCloudAutoGen(client=_mock_memory_client(), memory_id="m1")

        hooks = {}
        agent = MagicMock()
        agent.register_hook = lambda name, fn: hooks.update({name: fn})
        mc.inject_into_agent(agent)

        messages = [
            {"role": "system", "content": "You are a dev agent."},
            {"role": "user", "content": "What auth do we use?"},
        ]
        result = hooks["process_all_messages_before_reply"](messages)

        assert "[Relevant memories]" in result[0]["content"]
        assert "JWT" in result[0]["content"]
        # Original system prompt preserved
        assert "dev agent" in result[0]["content"]

    def test_tool_functions(self):
        from memory_cloud.integrations.autogen import MemoryCloudAutoGen

        mc = MemoryCloudAutoGen(client=_mock_memory_client(), memory_id="m1")
        tools = mc.get_tool_functions()
        assert len(tools) == 3
        names = {t["name"] for t in tools}
        assert "memory_search" in names


# ==================================================================
# PraisonAI Integration
# ==================================================================


class TestPraisonAIEcosystem:
    """Test PraisonAI adapter tool building."""

    def test_build_tools(self):
        from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

        mc = MemoryCloudPraisonAI(client=_mock_memory_client(), memory_id="m1")
        tools = mc.build_tools()

        assert len(tools) == 3
        names = {t["name"] for t in tools}
        assert names == {"memory_search", "memory_write", "memory_insights"}

    def test_inject_messages_creates_system(self):
        from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

        mc = MemoryCloudPraisonAI(client=_mock_memory_client(), memory_id="m1")
        messages = [{"role": "user", "content": "What tools?"}]
        result = mc.inject_into_messages(messages)

        # Should prepend a system message with memory context
        assert result[0]["role"] == "system"
        assert "JWT" in result[0]["content"] or "[Relevant memories]" in result[0]["content"]

    def test_session_source(self):
        from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

        mc = MemoryCloudPraisonAI(client=_mock_memory_client(), memory_id="m1")
        assert mc.source == "praisonai"

    def test_memory_search_callable(self):
        from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

        mc = MemoryCloudPraisonAI(client=_mock_memory_client(), memory_id="m1")
        result = mc.memory_search("architecture")
        parsed = json.loads(result)
        assert isinstance(parsed, list)
        assert len(parsed) == 2


# ==================================================================
# OpenAI Interceptor (direct)
# ==================================================================


class TestOpenAIInterceptorEcosystem:
    """Test interceptor with real openai package import."""

    @pytest.fixture(autouse=True)
    def _skip_if_missing(self):
        pytest.importorskip("openai", reason="openai not installed")

    def test_interceptor_wraps_openai_client(self):
        from memory_cloud.interceptor import AwarenessInterceptor

        client = _mock_memory_client()
        interceptor = AwarenessInterceptor(client=client, memory_id="mem-1")

        # Create real OpenAI client structure mock
        import openai
        oai = MagicMock(spec=openai.OpenAI)
        oai.chat = MagicMock()
        oai.chat.completions = MagicMock()

        mock_choice = MagicMock()
        mock_choice.message = MagicMock()
        mock_choice.message.content = "Response with memory"
        mock_resp = MagicMock()
        mock_resp.choices = [mock_choice]
        oai.chat.completions.create = MagicMock(return_value=mock_resp)

        interceptor.wrap_openai(oai)

        # The create method should now be wrapped
        result = oai.chat.completions.create(
            messages=[{"role": "user", "content": "Hello"}],
            model="gpt-4o-mini",
        )
        # retrieve should have been called for context injection
        assert client.retrieve.called


# ==================================================================
# Anthropic Interceptor
# ==================================================================


class TestAnthropicInterceptorEcosystem:
    """Test interceptor with real anthropic package import."""

    @pytest.fixture(autouse=True)
    def _skip_if_missing(self):
        pytest.importorskip("anthropic", reason="anthropic not installed")

    def test_interceptor_wraps_anthropic_client(self):
        from memory_cloud.interceptor import AwarenessInterceptor

        client = _mock_memory_client()
        interceptor = AwarenessInterceptor(client=client, memory_id="mem-1")

        import anthropic
        ant = MagicMock(spec=anthropic.Anthropic)
        ant.messages = MagicMock()

        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = "Anthropic response"
        mock_resp = MagicMock()
        mock_resp.content = [mock_block]
        ant.messages.create = MagicMock(return_value=mock_resp)

        interceptor.wrap_anthropic(ant)

        result = ant.messages.create(
            messages=[{"role": "user", "content": "Hello"}],
            model="claude-sonnet-4-6",
        )
        assert client.retrieve.called


# ==================================================================
# Cross-adapter consistency
# ==================================================================


class TestCrossAdapterConsistency:
    """Verify all adapters expose a consistent interface."""

    def test_all_adapters_have_common_methods(self):
        from memory_cloud.integrations.langchain import MemoryCloudLangChain
        from memory_cloud.integrations.crewai import MemoryCloudCrewAI
        from memory_cloud.integrations.autogen import MemoryCloudAutoGen
        from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

        adapters = [
            MemoryCloudLangChain(client=_mock_memory_client(), memory_id="m1"),
            MemoryCloudCrewAI(client=_mock_memory_client(), memory_id="m1"),
            MemoryCloudAutoGen(client=_mock_memory_client(), memory_id="m1"),
            MemoryCloudPraisonAI(client=_mock_memory_client(), memory_id="m1"),
        ]

        required_methods = ["memory_search", "memory_write", "memory_insights",
                            "inject_into_messages", "get_tool_functions"]

        for adapter in adapters:
            for method in required_methods:
                assert hasattr(adapter, method), f"{type(adapter).__name__} missing {method}"
                assert callable(getattr(adapter, method))

    def test_all_adapters_have_session_id(self):
        from memory_cloud.integrations.langchain import MemoryCloudLangChain
        from memory_cloud.integrations.crewai import MemoryCloudCrewAI
        from memory_cloud.integrations.autogen import MemoryCloudAutoGen
        from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

        for cls in [MemoryCloudLangChain, MemoryCloudCrewAI, MemoryCloudAutoGen, MemoryCloudPraisonAI]:
            adapter = cls(client=_mock_memory_client(), memory_id="m1")
            assert adapter.session_id == "sess-smoke"

    def test_all_adapters_source_identity(self):
        from memory_cloud.integrations.langchain import MemoryCloudLangChain
        from memory_cloud.integrations.crewai import MemoryCloudCrewAI
        from memory_cloud.integrations.autogen import MemoryCloudAutoGen
        from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

        expected = {
            MemoryCloudLangChain: "langchain",
            MemoryCloudCrewAI: "crewai",
            MemoryCloudAutoGen: "autogen",
            MemoryCloudPraisonAI: "praisonai",
        }
        for cls, expected_source in expected.items():
            adapter = cls(client=_mock_memory_client(), memory_id="m1")
            assert adapter.source == expected_source
