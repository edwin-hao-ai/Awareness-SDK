"""
End-to-end CrewAI example against a real Awareness Cloud API.

Required env:
- AWARENESS_API_BASE_URL (or legacy AWARENESS_BASE_URL, default: https://awareness.market/api/v1)
- AWARENESS_API_KEY
Optional env:
- AWARENESS_MEMORY_ID (reuse existing memory)
- AWARENESS_OWNER_ID (used only when creating memory)
"""

from memory_cloud.integrations.crewai import MemoryCloudCrewAI

from _e2e_common import build_client, ensure_memory, seed_memory


def main() -> None:
    client = build_client()
    memory_id = ensure_memory(client)
    seed_memory(client, memory_id, source="crewai-e2e")

    mc = MemoryCloudCrewAI(
        client=client,
        memory_id=memory_id,
        source="crewai-e2e",
        retrieve_limit=5,
    )
    print(f"memory_id={memory_id}")
    print(f"session_id={mc.session_id}")

    write_result = mc.memory_write(
        content="CrewAI e2e wrote this record through MemoryCloudCrewAI.",
        event_type="note",
    )
    print("write_result:", write_result)

    search_result = mc.memory_search(
        query="What record did CrewAI write in e2e test?",
        limit=5,
    )
    print("search_result:", search_result)

    tools = mc.get_tool_functions()
    print(f"Available tools: {[t['name'] for t in tools]}")


if __name__ == "__main__":
    main()
