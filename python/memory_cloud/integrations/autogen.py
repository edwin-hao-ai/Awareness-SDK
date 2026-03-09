"""AutoGen integration for Awareness Memory Cloud.

Supports both AG2 (autogen-agentchat >=0.4) and classic autogen (0.2.x).
Two usage patterns:

1. **Injection (recommended)** — hook into agent message processing:

    from memory_cloud import MemoryCloudClient
    from memory_cloud.integrations.autogen import MemoryCloudAutoGen

    client = MemoryCloudClient(base_url="...", api_key="...")
    mc = MemoryCloudAutoGen(client=client, memory_id="mem-xxx")

    # Hook into an AssistantAgent — pre-call retrieval + post-call storage
    mc.inject_into_agent(assistant)

2. **Tool registration** — let agents call search/write explicitly:

    mc.register_tools(caller=assistant, executor=user_proxy)
"""

import logging
from typing import Any, Dict, List, Optional

from memory_cloud.integrations._base import MemoryCloudBaseAdapter

logger = logging.getLogger(__name__)


class MemoryCloudAutoGen(MemoryCloudBaseAdapter):
    """AutoGen adapter for Awareness Memory Cloud.

    Provides two complementary integration modes:
    - inject_into_agent: transparent memory injection via message hooks
    - register_tools: explicit tool functions for agent-driven search/write
    """

    _default_source = "autogen"

    # ------------------------------------------------------------------
    # Pattern 1: Injection via agent hooks
    # ------------------------------------------------------------------

    def inject_into_agent(self, agent: Any) -> None:
        """Hook into an AutoGen ConversableAgent for transparent memory injection.

        Registers two hooks:
        - process_all_messages_before_reply: inject memory context into messages
        - process_message_before_send: store outgoing messages in background

        Works with both autogen 0.2.x and ag2 0.4+.
        """
        adapter = self

        def _inject_memory_hook(
            messages: List[Dict[str, Any]],
        ) -> List[Dict[str, Any]]:
            return adapter.inject_into_messages(messages)

        def _store_reply_hook(
            message: Any,
            *args: Any,
            **kwargs: Any,
        ) -> Any:
            text = ""
            if isinstance(message, dict):
                text = str(message.get("content", ""))
            elif isinstance(message, str):
                text = message
            adapter.store_assistant_message(text)
            return message

        if hasattr(agent, "register_hook"):
            agent.register_hook(
                "process_all_messages_before_reply", _inject_memory_hook
            )
            agent.register_hook(
                "process_message_before_send", _store_reply_hook
            )
        else:
            logger.warning(
                f"Agent {type(agent).__name__} does not support register_hook. "
                f"Use register_tools() instead."
            )

    # ------------------------------------------------------------------
    # Pattern 2: Explicit tool registration
    # ------------------------------------------------------------------

    def register_tools(
        self,
        caller: Any,
        executor: Any,
    ) -> None:
        """Register memory tools with AutoGen agents.

        Args:
            caller: The agent that calls tools (e.g. AssistantAgent).
            executor: The agent that executes tools (e.g. UserProxyAgent).
        """
        try:
            from autogen import register_function as _register_function
        except ImportError:
            try:
                from ag2 import register_function as _register_function
            except ImportError:
                raise ImportError(
                    "autogen or ag2 package is required. "
                    "Install with: pip install autogen-agentchat  or  pip install ag2"
                )

        for tool in self.get_tool_functions():
            _register_function(
                tool["callable"],
                caller=caller,
                executor=executor,
                name=tool["name"],
                description=tool["description"],
            )
