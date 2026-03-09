"""PraisonAI integration for Awareness Memory Cloud.

Usage:

    from memory_cloud import MemoryCloudClient
    from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

    client = MemoryCloudClient(base_url="...", api_key="...")
    mc = MemoryCloudPraisonAI(client=client, memory_id="mem-xxx")

    # Injection: wrap the LLM client
    import openai
    oai = openai.OpenAI()
    mc.wrap_llm(oai)

    # Or get tool dicts for PraisonAI agent config
    tools = mc.build_tools()
"""

import logging
from typing import Any, Callable, Dict, List

from memory_cloud.integrations._base import MemoryCloudBaseAdapter

logger = logging.getLogger(__name__)


class MemoryCloudPraisonAI(MemoryCloudBaseAdapter):
    """PraisonAI adapter for Awareness Memory Cloud.

    Provides:
    - wrap_llm / wrap_function: transparent memory injection
    - build_tools: return PraisonAI-compatible tool dicts
    - get_tool_functions / memory_search / memory_write / memory_insights
    """

    _default_source = "praisonai"

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

    def build_tools(self) -> List[Dict[str, Any]]:
        """Return PraisonAI-compatible tool definitions."""
        return self.get_tool_functions()
