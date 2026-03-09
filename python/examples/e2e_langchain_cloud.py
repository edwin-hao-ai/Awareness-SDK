"""
End-to-end LangChain example against a real Awareness Cloud API.

Required env:
- AWARENESS_API_BASE_URL (or legacy AWARENESS_BASE_URL, default: http://localhost:8000/api/v1)
- AWARENESS_API_KEY
Optional env:
- AWARENESS_MEMORY_ID (reuse existing memory)
- AWARENESS_OWNER_ID (used only when creating memory)
"""

from memory_cloud.integrations.langchain import MemoryCloudLangChain

from _e2e_common import build_client, ensure_memory, seed_memory


def main() -> None:
    client = build_client()
    memory_id = ensure_memory(client)
    seed_memory(client, memory_id=memory_id, source="langchain-e2e")

    mc = MemoryCloudLangChain(
        client=client,
        memory_id=memory_id,
        source="langchain-e2e",
        retrieve_limit=5,
    )
    print(f"memory_id={memory_id}")
    print(f"session_id={mc.session_id}")

    # Use as retriever (returns LangChain Document objects)
    retriever = mc.as_retriever()
    docs = retriever._get_relevant_documents("What SDK changes were done for export and docs?")
    print(f"docs={len(docs)}")
    for idx, doc in enumerate(docs, start=1):
        print(f"[{idx}] {doc.page_content}")

    # Direct search/write
    write_result = mc.memory_write(
        content="LangChain e2e wrote this record through MemoryCloudLangChain.",
    )
    print("write_result:", write_result)

    search_result = mc.memory_search(query="What did LangChain write?", limit=5)
    print("search_result:", search_result)


if __name__ == "__main__":
    main()
