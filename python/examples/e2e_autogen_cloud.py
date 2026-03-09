"""
End-to-end AutoGen integration example against a real Awareness Cloud API.

Demonstrates both patterns:
1. Injection — transparent memory injection via agent hooks
2. Tool registration — explicit search/write tools for agents

Required env:
- AWARENESS_API_BASE_URL (or legacy AWARENESS_BASE_URL, default: https://awareness.market/api/v1)
- AWARENESS_API_KEY
Optional env:
- AWARENESS_MEMORY_ID (reuse existing memory)
- AWARENESS_OWNER_ID (used only when creating memory)
"""

from memory_cloud.integrations.autogen import MemoryCloudAutoGen

from _e2e_common import build_client, ensure_memory, seed_memory


def main() -> None:
    # 1) Build real cloud client and ensure target memory exists.
    client = build_client()
    memory_id = ensure_memory(client)
    seed_memory(client, memory_id, source="autogen-e2e")

    # 2) Create AutoGen adapter.
    mc = MemoryCloudAutoGen(
        client=client,
        memory_id=memory_id,
        source="autogen-e2e",
        retrieve_limit=5,
    )
    print(f"memory_id={memory_id}")
    print(f"session_id={mc.session_id}")

    # 3) Tool-based: write to memory.
    write_result = mc.memory_write(
        content="AutoGen e2e wrote this record through MemoryCloudAutoGen.",
        event_type="note",
    )
    print("write_result:", write_result)

    # 4) Tool-based: search memory.
    search_result = mc.memory_search(
        query="What record did AutoGen write in e2e test?",
        limit=5,
    )
    print("search_result:", search_result)

    # 5) Tool-based: query insights.
    insights_result = mc.memory_insights(limit=10)
    print("insights_result:", insights_result)

    # 6) Get tool definitions (for manual registration with AG2 FunctionTool).
    tools = mc.get_tool_functions()
    print(f"Available tools: {[t['name'] for t in tools]}")

    # 7) Injection pattern demo (without real AutoGen agents).
    #    Shows how the pre-reply hook transforms messages.
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What SDK features were implemented?"},
    ]
    # Simulate the injection hook
    context = mc._retrieve_context("What SDK features were implemented?")
    if context:
        messages[0]["content"] = context + messages[0]["content"]
    print("injected system prompt preview:", messages[0]["content"][:200], "...")

    print("\nDone! To use with real AutoGen agents:")
    print("  mc.inject_into_agent(assistant)  # transparent injection")
    print("  mc.register_tools(caller=assistant, executor=user_proxy)  # explicit tools")


if __name__ == "__main__":
    main()
