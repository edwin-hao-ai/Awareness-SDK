"""LangChain integration for Awareness Memory Cloud.

Usage:

    from memory_cloud import MemoryCloudClient
    from memory_cloud.integrations.langchain import MemoryCloudLangChain

    client = MemoryCloudClient(base_url="...", api_key="...")
    mc = MemoryCloudLangChain(client=client, memory_id="mem-xxx")

    # Injection: wrap the LLM client
    import openai
    oai = openai.OpenAI()
    mc.wrap_llm(oai)

    # Or use as a LangChain Retriever
    retriever = mc.as_retriever()
    docs = retriever.invoke("search query")
"""

import logging
from typing import Any, Callable, Dict, List, Optional

from memory_cloud.integrations._base import MemoryCloudBaseAdapter

logger = logging.getLogger(__name__)

try:
    from langchain.callbacks.manager import CallbackManagerForRetrieverRun
    from langchain.schema import BaseRetriever, Document
except Exception:  # pragma: no cover
    try:
        from langchain_core.callbacks import CallbackManagerForRetrieverRun
        from langchain_core.documents import Document
        from langchain_core.retrievers import BaseRetriever
    except Exception:  # pragma: no cover
        class CallbackManagerForRetrieverRun:  # type: ignore[no-redef]
            pass

        class Document:  # type: ignore[no-redef]
            def __init__(self, page_content: str, metadata: Optional[Dict[str, Any]] = None):
                self.page_content = page_content
                self.metadata = metadata or {}

        class BaseRetriever:  # type: ignore[no-redef]
            def __init__(self, **kwargs):
                for key, value in kwargs.items():
                    setattr(self, key, value)


class MemoryCloudLangChain(MemoryCloudBaseAdapter):
    """LangChain adapter for Awareness Memory Cloud.

    Provides:
    - wrap_llm / wrap_function: transparent memory injection
    - as_retriever: return a LangChain BaseRetriever
    - get_tool_functions / memory_search / memory_write / memory_insights
    """

    _default_source = "langchain"

    def wrap_llm(self, llm_client: Any) -> None:
        """Wrap an OpenAI/Anthropic client for transparent memory injection."""
        from memory_cloud.interceptor import AwarenessInterceptor

        interceptor = AwarenessInterceptor(
            client=self.client,
            memory_id=self.memory_id,
            source=self.source,
            session_id=self._session_id,
            user_id=self.user_id,
            agent_role=self.agent_role,
            retrieve_limit=self.retrieve_limit,
            max_context_chars=self.max_context_chars,
            auto_remember=self.auto_remember,
            enable_extraction=self.enable_extraction,
            on_error=self.on_error,
        )

        client_type = type(llm_client).__module__
        if "openai" in client_type:
            interceptor.wrap_openai(llm_client)
        elif "anthropic" in client_type:
            interceptor.wrap_anthropic(llm_client)
        else:
            logger.warning(
                f"Unknown LLM client type: {type(llm_client).__name__}. "
                f"Attempting OpenAI-compatible wrapping."
            )
            interceptor.wrap_openai(llm_client)

    def wrap_function(self, fn: Callable) -> Callable:
        """Wrap a completion function (e.g. litellm.completion) for injection."""
        from memory_cloud.interceptor import AwarenessInterceptor

        interceptor = AwarenessInterceptor(
            client=self.client,
            memory_id=self.memory_id,
            source=self.source,
            session_id=self._session_id,
            user_id=self.user_id,
            agent_role=self.agent_role,
            retrieve_limit=self.retrieve_limit,
            max_context_chars=self.max_context_chars,
            auto_remember=self.auto_remember,
            enable_extraction=self.enable_extraction,
            on_error=self.on_error,
        )
        return interceptor.register_function(fn)

    def as_retriever(self) -> "_MemoryCloudRetriever":
        """Return a LangChain-compatible retriever backed by this adapter."""
        return _MemoryCloudRetriever(adapter=self)

    def retrieve_documents(self, query: str) -> List[Document]:
        """Retrieve memory as LangChain Document objects."""
        try:
            data = self.client.retrieve(
                memory_id=self.memory_id,
                query=query,
                limit=self.retrieve_limit,
                metadata_filter=self._build_metadata_filter(),
            )
        except Exception:
            return []

        docs: List[Document] = []
        for item in data.get("results", []):
            if not isinstance(item, dict):
                continue
            content = item.get("content", "")
            metadata = {k: v for k, v in item.items() if k != "content"}
            docs.append(Document(page_content=str(content), metadata=metadata))
        return docs


class _MemoryCloudRetriever(BaseRetriever):
    """Internal LangChain Retriever that delegates to MemoryCloudLangChain adapter."""

    adapter: Any = None

    def __init__(self, adapter: MemoryCloudLangChain, **kwargs: Any):
        super().__init__(**kwargs)
        self.adapter = adapter

    def _get_relevant_documents(
        self,
        query: str,
        *,
        run_manager: Optional[CallbackManagerForRetrieverRun] = None,
    ) -> List[Document]:
        return self.adapter.retrieve_documents(query)
