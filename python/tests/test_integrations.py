from unittest.mock import MagicMock
import os

from memory_cloud.integrations.crewai import MemoryCloudCrewAI
from memory_cloud.integrations.langchain import MemoryCloudLangChain
from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI
from memory_cloud.integrations.autogen import MemoryCloudAutoGen

API_BASE_URL = os.getenv("AWARENESS_API_BASE_URL", os.getenv("AWARENESS_BASE_URL", "http://localhost:8000/api/v1"))


def _mock_client(**overrides):
    """Create a mock MemoryCloudClient with sensible defaults."""
    defaults = {
        "_begin_memory_session": MagicMock(return_value={"session_id": "sess-1"}),
        "retrieve": MagicMock(return_value={"results": [{"content": "test-doc"}]}),
        "record": MagicMock(return_value={"status": "ok", "events_sent": 1}),
        "insights": MagicMock(return_value={"knowledge_cards": [], "risks": [], "action_items": []}),
        "base_url": API_BASE_URL,
        "api_key": "k1",
    }
    defaults.update(overrides)
    return MagicMock(**defaults)


# ------------------------------------------------------------------
# AutoGen
# ------------------------------------------------------------------


def test_autogen_memory_search():
    mc = MemoryCloudAutoGen(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "autogen-doc"}]}),
        ),
        memory_id="m1",
    )
    output = mc.memory_search("find")
    assert "autogen-doc" in output


def test_autogen_memory_write():
    mc = MemoryCloudAutoGen(client=_mock_client(), memory_id="m1", auto_remember=False)
    output = mc.memory_write("important decision")
    assert "ok" in output


def test_autogen_get_tool_functions():
    mc = MemoryCloudAutoGen(client=_mock_client(), memory_id="m1")
    tools = mc.get_tool_functions()
    assert len(tools) == 3
    names = [t["name"] for t in tools]
    assert "memory_search" in names
    assert "memory_write" in names
    assert "memory_insights" in names


def test_autogen_inject_into_agent():
    mc = MemoryCloudAutoGen(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "injected-memory"}]}),
        ),
        memory_id="m1",
        auto_remember=False,
    )

    agent = MagicMock()
    hooks = {}

    def fake_register_hook(hook_name, fn):
        hooks[hook_name] = fn

    agent.register_hook = fake_register_hook
    mc.inject_into_agent(agent)

    assert "process_all_messages_before_reply" in hooks
    assert "process_message_before_send" in hooks

    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "What did we decide about auth?"},
    ]
    result = hooks["process_all_messages_before_reply"](messages)
    assert "[Relevant memories]" in result[0]["content"]
    assert "injected-memory" in result[0]["content"]
    assert "You are helpful." in result[0]["content"]


def test_autogen_session():
    mc = MemoryCloudAutoGen(client=_mock_client(), memory_id="m1")
    assert mc.session_id == "sess-1"
    assert mc.source == "autogen"


# ------------------------------------------------------------------
# CrewAI
# ------------------------------------------------------------------


def test_crewai_memory_search():
    mc = MemoryCloudCrewAI(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "crewai-doc"}]}),
        ),
        memory_id="m1",
    )
    output = mc.memory_search("find")
    assert "crewai-doc" in output


def test_crewai_memory_write():
    mc = MemoryCloudCrewAI(client=_mock_client(), memory_id="m1", auto_remember=False)
    output = mc.memory_write("crew decision")
    assert "ok" in output


def test_crewai_get_tool_functions():
    mc = MemoryCloudCrewAI(client=_mock_client(), memory_id="m1")
    tools = mc.get_tool_functions()
    assert len(tools) == 3


def test_crewai_session():
    mc = MemoryCloudCrewAI(client=_mock_client(), memory_id="m1")
    assert mc.session_id == "sess-1"
    assert mc.source == "crewai"


def test_crewai_inject_messages():
    mc = MemoryCloudCrewAI(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "crew-memory"}]}),
        ),
        memory_id="m1",
        auto_remember=False,
    )
    messages = [
        {"role": "system", "content": "You are a crew agent."},
        {"role": "user", "content": "What tasks are pending?"},
    ]
    result = mc.inject_into_messages(messages)
    assert "[Relevant memories]" in result[0]["content"]
    assert "crew-memory" in result[0]["content"]


# ------------------------------------------------------------------
# LangChain
# ------------------------------------------------------------------


def test_langchain_memory_search():
    mc = MemoryCloudLangChain(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "langchain-doc"}]}),
        ),
        memory_id="m1",
    )
    output = mc.memory_search("find")
    assert "langchain-doc" in output


def test_langchain_memory_write():
    mc = MemoryCloudLangChain(client=_mock_client(), memory_id="m1", auto_remember=False)
    output = mc.memory_write("chain decision")
    assert "ok" in output


def test_langchain_as_retriever():
    mc = MemoryCloudLangChain(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "retriever-doc", "id": "c1"}]}),
        ),
        memory_id="m1",
    )
    retriever = mc.as_retriever()
    docs = retriever._get_relevant_documents("query")
    assert len(docs) == 1
    assert docs[0].page_content == "retriever-doc"


def test_langchain_retrieve_documents():
    mc = MemoryCloudLangChain(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "doc-1", "id": "c1"}]}),
        ),
        memory_id="m1",
    )
    docs = mc.retrieve_documents("query")
    assert len(docs) == 1
    assert docs[0].page_content == "doc-1"


def test_langchain_session():
    mc = MemoryCloudLangChain(client=_mock_client(), memory_id="m1")
    assert mc.session_id == "sess-1"
    assert mc.source == "langchain"


def test_langchain_inject_messages():
    mc = MemoryCloudLangChain(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "chain-memory"}]}),
        ),
        memory_id="m1",
        auto_remember=False,
    )
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "What happened last sprint?"},
    ]
    result = mc.inject_into_messages(messages)
    assert "[Relevant memories]" in result[0]["content"]
    assert "chain-memory" in result[0]["content"]


# ------------------------------------------------------------------
# PraisonAI
# ------------------------------------------------------------------


def test_praisonai_memory_search():
    mc = MemoryCloudPraisonAI(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "praison-doc"}]}),
        ),
        memory_id="m1",
    )
    output = mc.memory_search("find")
    assert "praison-doc" in output


def test_praisonai_memory_write():
    mc = MemoryCloudPraisonAI(client=_mock_client(), memory_id="m1", auto_remember=False)
    output = mc.memory_write("praison decision")
    assert "ok" in output


def test_praisonai_build_tools():
    mc = MemoryCloudPraisonAI(client=_mock_client(), memory_id="m1")
    tools = mc.build_tools()
    assert len(tools) == 3
    names = [t["name"] for t in tools]
    assert "memory_search" in names
    assert "memory_write" in names
    assert "memory_insights" in names


def test_praisonai_session():
    mc = MemoryCloudPraisonAI(client=_mock_client(), memory_id="m1")
    assert mc.session_id == "sess-1"
    assert mc.source == "praisonai"


def test_praisonai_inject_messages():
    mc = MemoryCloudPraisonAI(
        client=_mock_client(
            retrieve=MagicMock(return_value={"results": [{"content": "praison-memory"}]}),
        ),
        memory_id="m1",
        auto_remember=False,
    )
    messages = [
        {"role": "user", "content": "What tools are available?"},
    ]
    result = mc.inject_into_messages(messages)
    assert result[0]["role"] == "system"
    assert "praison-memory" in result[0]["content"]
