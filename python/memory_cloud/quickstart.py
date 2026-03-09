"""High-level quickstart helpers for prompt-only SDK integration."""

from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any, Dict, Optional

from memory_cloud.client import MemoryCloudClient
from memory_cloud.interceptor import AwarenessInterceptor


def _env_or_default(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


def _require_value(name: str, value: Optional[str]) -> str:
    resolved = (value or "").strip()
    if not resolved:
        raise ValueError(f"{name} is required")
    return resolved


@dataclass
class InjectedOpenAISession:
    """Ready-to-use injected OpenAI session."""

    memory_client: MemoryCloudClient
    openai_client: Any
    interceptor: AwarenessInterceptor
    memory_id: str


def bootstrap_openai_injected_session(
    *,
    memory_id: Optional[str] = None,
    owner_id: Optional[str] = None,
    user_id: Optional[str] = None,
    agent_role: Optional[str] = None,
    source: str = "sdk-quickstart",
    memory_name: str = "SDK Quickstart Memory",
    memory_description: str = "Auto-created memory for SDK quickstart usage.",
    memory_config: Optional[Dict[str, Any]] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    memory_client: Optional[MemoryCloudClient] = None,
    openai_client: Optional[Any] = None,
    llm_base_url: Optional[str] = None,
    llm_api_key: Optional[str] = None,
) -> InjectedOpenAISession:
    """Create a ready-to-use OpenAI client with Awareness injection enabled.

    Behavior:
    1. Resolve/create MemoryCloudClient.
    2. Reuse provided memory_id, or create a new memory when memory_id is missing.
    3. Resolve/create OpenAI client.
    4. Inject interceptor so callers only send prompts.
    """

    mc = memory_client
    if mc is None:
        resolved_base_url = _env_or_default(
            "AWARENESS_API_BASE_URL",
            "AWARENESS_BASE_URL",
            default="http://localhost:8000/api/v1",
        )
        resolved_api_key = _env_or_default("AWARENESS_API_KEY")
        mc = MemoryCloudClient(
            base_url=(base_url or resolved_base_url),
            api_key=_require_value("AWARENESS_API_KEY", api_key or resolved_api_key),
        )

    resolved_memory_id = (memory_id or "").strip()
    if not resolved_memory_id:
        resolved_owner_id = (owner_id or "").strip()
        if not resolved_owner_id:
            resolved_owner_id = _env_or_default(
                "AWARENESS_OWNER_ID",
                "SDK_DEMO_USER_ID",
                default=(user_id or "").strip(),
            )
        resolved_owner_id = _require_value("owner_id", resolved_owner_id)
        created = mc.create_memory(
            {
                "name": memory_name,
                "description": memory_description,
                "owner_id": resolved_owner_id,
                "is_public": False,
                "custom_type": "universal",
                "config": memory_config or {"default_source": source, "metadata_defaults": {}},
            }
        )
        resolved_memory_id = str(created.get("id") or "").strip()
        resolved_memory_id = _require_value("memory_id", resolved_memory_id)

    oai = openai_client
    if oai is None:
        try:
            from openai import OpenAI
        except Exception as exc:  # pragma: no cover - runtime dependency guard
            raise RuntimeError(
                "openai package is required. Install with: pip install awareness-memory-cloud[openai]"
            ) from exc

        resolved_llm_base_url = llm_base_url or _env_or_default(
            "AI_GATEWAY_URL",
            "OPENAI_API_BASE",
            default="https://ai-gateway.vercel.sh/v1",
        )
        resolved_llm_key = llm_api_key or _env_or_default(
            "AI_GATEWAY_API_KEY",
            "OPENAI_API_KEY",
        )
        oai = OpenAI(
            api_key=_require_value("OPENAI_API_KEY", resolved_llm_key),
            base_url=resolved_llm_base_url,
        )

    interceptor = AwarenessInterceptor(
        client=mc,
        memory_id=resolved_memory_id,
        source=source,
        user_id=user_id,
        agent_role=agent_role,
    )
    interceptor.wrap_openai(oai)

    return InjectedOpenAISession(
        memory_client=mc,
        openai_client=oai,
        interceptor=interceptor,
        memory_id=resolved_memory_id,
    )
