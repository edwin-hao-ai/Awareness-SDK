import os

from memory_cloud import MemoryCloudClient


def main():
    # 1) Create client and point it to /api/v1.
    client = MemoryCloudClient(
        base_url=os.getenv("AWARENESS_API_BASE_URL", os.getenv("AWARENESS_BASE_URL", "https://awareness.market/api/v1")),
        api_key="YOUR_API_KEY",
    )

    # 2) Record a meaningful step using the unified record() interface.
    # Sessions are managed automatically — no need to call _begin_memory_session explicitly.
    write_result = client.record(
        memory_id="your-memory-id",
        content="Implemented export package parser and added SDK docs.",
        source="python-sdk",
        metadata={"stage": "implementation", "tool_name": "python"},
    )
    print("record:", write_result)

    # 3) Recall task context and run generic retrieve.
    recall_result = client.recall_for_task(
        memory_id="your-memory-id",
        task="summarize latest export-related progress",
        limit=5,
    )
    print("recall_for_task:", recall_result)

    retrieve_result = client.retrieve(
        memory_id="your-memory-id",
        query="What changed for export and SDK?",
        custom_kwargs={"k": 5},
    )
    print("retrieve:", retrieve_result)


if __name__ == "__main__":
    main()
