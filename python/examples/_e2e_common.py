import os
import time
import uuid
from typing import Optional

from memory_cloud import MemoryCloudClient


def get_required_env(name: str, fallback: Optional[str] = None) -> str:
    value = os.getenv(name, fallback)
    if value is None or not str(value).strip():
        raise RuntimeError(f"Missing required env: {name}")
    return str(value).strip()


def build_client() -> MemoryCloudClient:
    api_base = os.getenv("AWARENESS_API_BASE_URL", os.getenv("AWARENESS_BASE_URL", "https://awareness.market/api/v1"))
    return MemoryCloudClient(
        base_url=get_required_env("AWARENESS_API_BASE_URL", api_base),
        api_key=get_required_env("AWARENESS_API_KEY", ""),
        timeout=float(os.getenv("AWARENESS_TIMEOUT", "60")),
        max_retries=int(os.getenv("AWARENESS_MAX_RETRIES", "2")),
    )


def ensure_memory(client: MemoryCloudClient) -> str:
    existing = os.getenv("AWARENESS_MEMORY_ID", "").strip()
    if existing:
        return existing

    owner_id = get_required_env("AWARENESS_OWNER_ID", "sdk-e2e-user")
    created = client.create_memory(
        {
            "name": f"sdk-e2e-{uuid.uuid4().hex[:8]}",
            "description": "Temporary memory for SDK e2e examples",
            "custom_type": "universal",
            "config": {
                "default_source": "sdk-e2e",
                "metadata_defaults": {"agent_role": "sdk_e2e"},
            },
            "owner_id": owner_id,
            "is_public": False,
        }
    )
    memory_id = str(created.get("id") or "").strip()
    if not memory_id:
        raise RuntimeError(f"Failed to create memory: {created}")
    return memory_id


def seed_memory(client: MemoryCloudClient, memory_id: str, source: str) -> None:
    points = [
        "Implemented SDK export reader for manifest/chunks/kv summary.",
        "Added MCP-aligned helpers for session, recall, remember and backfill.",
        "Built SDK page with online docs and package-manager installation guidance.",
    ]
    for point in points:
        client.write(
            memory_id=memory_id,
            content=point,
            kwargs={"source": source, "session_id": f"e2e-{source}"},
            async_vectorize=False,
        )
    time.sleep(float(os.getenv("AWARENESS_EMBED_WAIT", "0.3")))
