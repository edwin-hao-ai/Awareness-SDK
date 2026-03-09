"""
End-to-end PraisonAI example against a real Awareness Cloud API.

Required env:
- AWARENESS_API_BASE_URL (or legacy AWARENESS_BASE_URL, default: http://localhost:8000/api/v1)
- AWARENESS_API_KEY
Optional env:
- AWARENESS_MEMORY_ID (reuse existing memory)
- AWARENESS_OWNER_ID (used only when creating memory)
"""

from memory_cloud.integrations.praisonai import MemoryCloudPraisonAI

from _e2e_common import build_client, ensure_memory


def main() -> None:
    client = build_client()
    memory_id = ensure_memory(client)

    mc = MemoryCloudPraisonAI(
        client=client,
        memory_id=memory_id,
        source="praisonai-e2e",
        retrieve_limit=5,
    )
    print(f"memory_id={memory_id}")
    print(f"session_id={mc.session_id}")

    write_result = mc.memory_write(
        content="PraisonAI e2e wrote this record through MemoryCloudPraisonAI.",
    )
    print("write_result:", write_result)

    search_result = mc.memory_search(
        query="What did PraisonAI write in the e2e run?",
        limit=5,
    )
    print("search_result:", search_result)

    insights_result = mc.memory_insights(limit=50)
    print("insights_result:", insights_result)

    tools = mc.build_tools()
    print(f"Available tools: {[t['name'] for t in tools]}")


if __name__ == "__main__":
    main()
