import ast
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, Union

import requests

from memory_cloud.errors import MemoryCloudError

logger = logging.getLogger(__name__)

RETRYABLE_STATUSES = {429, 500, 502, 503, 504}

_DEFAULT_EXTRACTION_MAX_TOKENS = 16384


class MemoryCloudClient:
    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout: float = 30.0,
        max_retries: int = 2,
        backoff_seconds: float = 0.5,
        session: Optional[requests.Session] = None,
        session_prefix: str = "sdk",
        default_source: str = "sdk",
        # Auto-extraction: pass an OpenAI/Anthropic client to enable
        enable_extraction: bool = False,
        extraction_llm: Optional[Any] = None,
        extraction_model: Optional[str] = None,
        extraction_max_tokens: Optional[int] = None,
        user_id: Optional[str] = None,
        agent_role: Optional[str] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max(0, max_retries)
        self.backoff_seconds = max(0.0, backoff_seconds)
        self.session = session or requests.Session()
        self.session_prefix = session_prefix
        self.default_source = default_source
        self._session_cache: Dict[str, str] = {}

        # Auto-extraction config
        self.enable_extraction = enable_extraction or (extraction_llm is not None)
        self._extraction_llm = extraction_llm
        self._extraction_model = extraction_model
        self._extraction_max_tokens = (
            extraction_max_tokens
            or int(os.getenv("AWARENESS_EXTRACTION_MAX_TOKENS", "0"))
            or _DEFAULT_EXTRACTION_MAX_TOKENS
        )
        self._user_id = user_id
        self._agent_role = agent_role
        self._llm_type: Optional[str] = None  # "openai" | "anthropic"

        if self._extraction_llm is not None:
            self._llm_type = _detect_llm_type(self._extraction_llm)

    # ----------------------------
    # Memory CRUD
    # ----------------------------
    def create_memory(self, payload: Dict[str, Any], trace_id: Optional[str] = None) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="POST",
            path="/memories",
            json_payload=payload,
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def list_memories(
        self,
        owner_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
        trace_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"skip": max(0, skip), "limit": max(1, limit)}
        if owner_id:
            params["owner_id"] = owner_id
        data, _ = self._request_any(
            method="GET",
            path="/memories",
            params=params,
            trace_id=trace_id,
        )
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    def get_memory(self, memory_id: str, trace_id: Optional[str] = None) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="GET",
            path=f"/memories/{memory_id}",
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def update_memory(
        self,
        memory_id: str,
        payload: Dict[str, Any],
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="PATCH",
            path=f"/memories/{memory_id}",
            json_payload=payload,
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def delete_memory(self, memory_id: str, trace_id: Optional[str] = None) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="DELETE",
            path=f"/memories/{memory_id}",
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    # ----------------------------
    # Content / Timeline / Chat
    # ----------------------------
    def list_memory_content(
        self,
        memory_id: str,
        limit: int = 100,
        offset: int = 0,
        trace_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        data, _ = self._request_any(
            method="GET",
            path=f"/memories/{memory_id}/content",
            params={"limit": max(1, limit), "offset": max(0, offset)},
            trace_id=trace_id,
        )
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    def retrieve(
        self,
        memory_id: str,
        query: str,
        limit: int = 12,
        use_hybrid_search: Optional[bool] = None,
        use_mmr: bool = False,
        mmr_lambda: float = 0.5,
        reconstruct_chunks: bool = True,
        max_stitched_chars: int = 4000,
        recall_mode: str = "precise",
        max_sessions: int = 5,
        max_session_chars: int = 8000,
        custom_kwargs: Optional[Dict[str, Any]] = None,
        metadata_filter: Optional[Dict[str, Any]] = None,
        permission_filter: str = "private",
        keyword_query: Optional[str] = None,
        scope: Optional[str] = None,
        confidence_threshold: Optional[float] = None,
        include_raw_chunks: bool = False,
        user_id: Optional[str] = None,
        agent_role: Optional[str] = None,
        multi_level: bool = False,
        cluster_expand: bool = False,
        include_installed: bool = False,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Retrieve from memory using the specified recall mode.

        Default: "precise" for low-level SDK calls. Higher-level helpers keep
        using "hybrid" by default for more reliable continuation recall.

        recall_mode options:
          - "precise": chunk reconstruction only (fast, targeted)
          - "session": expand matched anchors to complete session histories
          - "structured": zero-LLM DB-only — returns cards + narratives + tasks (~1-2k tokens)
          - "hybrid": structured data + top-K vector results (~2-4k tokens)
          - "auto": detect from query intent

        multi_level: Enable broader context retrieval across sessions and time ranges.
        cluster_expand: Enable topic-based context expansion for deeper exploration.
        include_installed: Search installed market memories alongside primary memory.
        """
        merged: Dict[str, Any] = {
            "limit": limit,
            "reconstruct_chunks": reconstruct_chunks,
            "max_stitched_chars": max_stitched_chars,
            "recall_mode": recall_mode,
            "max_sessions": max_sessions,
            "max_session_chars": max_session_chars,
        }
        if use_hybrid_search is not None:
            merged["use_hybrid_search"] = use_hybrid_search
        if use_mmr:
            merged["use_mmr"] = True
            merged["mmr_lambda"] = mmr_lambda
        merged.update(custom_kwargs or {})

        # Scope-based metadata filtering
        resolved_filter = dict(metadata_filter or {})
        if scope and scope != "all":
            scope_map = {
                "timeline": ["timeline"],
                "knowledge": ["knowledge", "full_source"],
                "insights": ["insight_summary"],
            }
            if scope in scope_map:
                resolved_filter["aw_content_scope"] = scope_map[scope]
        # Auto-extract keywords for full-text search if not provided (same as MCP server behavior)
        effective_keyword = keyword_query
        if not effective_keyword:
            from memory_cloud.query_rewrite import extract_keywords
            effective_keyword = extract_keywords(query)
        if effective_keyword:
            merged["keyword_query"] = effective_keyword

        body: Dict[str, Any] = {
            "query": query,
            "keyword_query": effective_keyword,
            "custom_kwargs": merged,
            "metadata_filter": resolved_filter or None,
            "permission_filter": permission_filter,
            "recall_mode": recall_mode,
        }
        if confidence_threshold is not None:
            body["confidence_threshold"] = confidence_threshold
        if include_raw_chunks:
            body["include_raw_chunks"] = True
        if user_id:
            body["user_id"] = user_id
        if agent_role:
            body["agent_role"] = agent_role
        if multi_level:
            body["multi_level"] = True
        if cluster_expand:
            body["cluster_expand"] = True
        if include_installed:
            body["include_installed"] = True

        payload, resolved_trace_id = self._request(
            method="POST",
            path=f"/memories/{memory_id}/retrieve",
            json_payload=body,
            trace_id=trace_id,
        )
        return self._attach_trace(payload, resolved_trace_id)

    def write(
        self,
        memory_id: str,
        content: Any,
        kwargs: Optional[Dict[str, Any]] = None,
        async_vectorize: bool = True,
        idempotency_key: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload, resolved_trace_id = self._request(
            method="POST",
            path=f"/memories/{memory_id}/content",
            json_payload={
                "content": content,
                "kwargs": kwargs or {},
                "async_vectorize": async_vectorize,
            },
            trace_id=trace_id,
            idempotency_key=idempotency_key or str(uuid.uuid4()),
        )
        return self._attach_trace(payload, resolved_trace_id)

    def delete_memory_content(
        self,
        memory_id: str,
        content_id: str,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="DELETE",
            path=f"/memories/{memory_id}/content/{content_id}",
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def memory_timeline(
        self,
        memory_id: str,
        limit: int = 200,
        offset: int = 0,
        session_id: Optional[str] = None,
        include_summaries: bool = True,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "limit": max(1, limit),
            "offset": max(0, offset),
            "include_summaries": str(bool(include_summaries)).lower(),
        }
        if session_id:
            params["session_id"] = session_id
        data, resolved_trace = self._request(
            method="GET",
            path=f"/memories/{memory_id}/timeline",
            params=params,
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def chat(
        self,
        memory_id: str,
        query: str,
        model: Optional[str] = None,
        session_id: Optional[str] = None,
        metadata_filter: Optional[Dict[str, Any]] = None,
        context_budget_tokens: Optional[int] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "query": query,
            "stream": False,
            "model": model,
            "session_id": session_id,
            "metadata_filter": metadata_filter,
            "context_budget_tokens": context_budget_tokens,
        }
        data, resolved_trace = self._request(
            method="POST",
            path=f"/memories/{memory_id}/chat",
            json_payload=payload,
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def chat_stream(
        self,
        memory_id: str,
        query: str,
        model: Optional[str] = None,
        session_id: Optional[str] = None,
        metadata_filter: Optional[Dict[str, Any]] = None,
        context_budget_tokens: Optional[int] = None,
        trace_id: Optional[str] = None,
    ) -> Iterable[Dict[str, Any]]:
        payload: Dict[str, Any] = {
            "query": query,
            "stream": True,
            "model": model,
            "session_id": session_id,
            "metadata_filter": metadata_filter,
            "context_budget_tokens": context_budget_tokens,
        }
        response, resolved_trace_id = self._request_response(
            method="POST",
            path=f"/memories/{memory_id}/chat",
            json_payload=payload,
            trace_id=trace_id,
            stream=True,
        )
        try:
            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue
                parsed = self._safe_json_loads(line)
                if isinstance(parsed, dict):
                    yield self._attach_trace(parsed, resolved_trace_id)
                else:
                    yield self._attach_trace({"raw": line}, resolved_trace_id)
        finally:
            response.close()

    # ----------------------------
    # Ingest / MCP-style helpers
    # ----------------------------
    def ingest_events(
        self,
        memory_id: str,
        events: List[Dict[str, Any]],
        default_source: str = "mcp",
        metadata_defaults: Optional[Dict[str, Any]] = None,
        skip_duplicates: bool = True,
        generate_summary: bool = True,
        summary_min_new_events: int = 6,
        use_latent_summary: bool = True,
        summary_instruction: Optional[str] = None,
        async_vectorize: bool = True,
        agent_role: Optional[str] = None,
        user_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "memory_id": memory_id,
            "events": events,
            "default_source": default_source,
            "metadata_defaults": metadata_defaults or {},
            "skip_duplicates": skip_duplicates,
            "generate_summary": generate_summary,
            "summary_min_new_events": summary_min_new_events,
            "use_latent_summary": use_latent_summary,
            "summary_instruction": summary_instruction,
            "async_vectorize": async_vectorize,
        }
        if agent_role:
            payload["agent_role"] = agent_role
        if user_id:
            payload["user_id"] = user_id

        data, resolved_trace_id = self._request(
            method="POST",
            path="/mcp/events",
            json_payload=payload,
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace_id)

    def ingest_content(
        self,
        memory_id: str,
        content: Any,
        agent_role: Optional[str] = None,
        source: Optional[str] = None,
        metadata_defaults: Optional[Dict[str, Any]] = None,
        async_vectorize: bool = True,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "memory_id": memory_id,
            "content": content,
            "async_vectorize": async_vectorize,
            "metadata_defaults": metadata_defaults or {},
        }
        if agent_role:
            payload["agent_role"] = agent_role
        if source:
            payload["default_source"] = source

        data, resolved_trace = self._request(
            method="POST",
            path="/mcp/events",
            json_payload=payload,
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def begin_memory_session(
        self,
        memory_id: str,
        source: str = "",
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        source_label = self._clean_source(source or self.default_source)
        active_session = self._resolve_session(
            memory_id=memory_id,
            source=source_label,
            session_id=session_id,
            rotate=not bool(session_id),
        )
        return {
            "memory_id": memory_id,
            "source": source_label,
            "session_id": active_session,
        }

    def recall_for_task(
        self,
        memory_id: str,
        task: str,
        limit: int = 12,
        source: str = "",
        session_id: Optional[str] = None,
        use_hybrid_search: bool = True,
        use_mmr: bool = False,
        mmr_lambda: float = 0.5,
        reconstruct_chunks: bool = True,
        max_stitched_chars: int = 4000,
        recall_mode: str = "hybrid",
        max_sessions: int = 5,
        max_session_chars: int = 8000,
        metadata_filter: Optional[Dict[str, Any]] = None,
        keyword_query: Optional[str] = None,
        scope: Optional[str] = None,
        confidence_threshold: Optional[float] = None,
        include_raw_chunks: bool = False,
        user_id: Optional[str] = None,
        agent_role: Optional[str] = None,
        multi_level: bool = False,
        cluster_expand: bool = False,
        include_installed: bool = False,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Recall relevant context for a task.

        recall_mode options:
          - "precise": chunk reconstruction only
          - "session": expand to complete session histories
          - "structured": zero-LLM DB-only (~1-2k tokens)
          - "hybrid" (default): structured + top-K vector results (~2-4k tokens)
          - "auto": detect from query intent

        multi_level: Enable broader context retrieval across sessions and time ranges.
        cluster_expand: Enable topic-based context expansion for deeper exploration.
        include_installed: Search installed market memories alongside primary memory.
        """
        source_label = self._clean_source(source or self.default_source)
        active_session = self._resolve_session(
            memory_id=memory_id,
            source=source_label,
            session_id=session_id,
            rotate=False,
        )
        query = (
            f"{task}\n"
            "Return architecture decisions, changed files, completed work, remaining todos, and blockers."
        )
        data = self.retrieve(
            memory_id=memory_id,
            query=query,
            limit=max(1, min(limit, 30)),
            use_hybrid_search=use_hybrid_search,
            use_mmr=use_mmr,
            mmr_lambda=mmr_lambda,
            reconstruct_chunks=reconstruct_chunks,
            max_stitched_chars=max_stitched_chars,
            recall_mode=recall_mode,
            max_sessions=max_sessions,
            max_session_chars=max_session_chars,
            metadata_filter=metadata_filter,
            keyword_query=keyword_query,
            scope=scope,
            confidence_threshold=confidence_threshold,
            include_raw_chunks=include_raw_chunks,
            user_id=user_id,
            agent_role=agent_role,
            multi_level=multi_level,
            cluster_expand=cluster_expand,
            trace_id=trace_id,
        )
        return {
            "memory_id": memory_id,
            "source": source_label,
            "session_id": active_session,
            "results": data.get("results", []),
            "trace_id": data.get("trace_id"),
        }

    # ------------------------------------------------------------------
    # LLM-based reranking (client-side, uses user's LLM)
    # ------------------------------------------------------------------

    def rerank(
        self,
        query: str,
        results: List[Dict[str, Any]],
        top_k: int = 5,
        max_content_chars: int = 200,
    ) -> List[Dict[str, Any]]:
        """Rerank retrieval results using the user's LLM as a cross-encoder.

        This is a client-side operation — it sends the query and candidate
        snippets to the LLM configured via ``extraction_llm`` and asks it to
        rank them by relevance.  No server-side LLM calls are made.

        Args:
            query: The original search query.
            results: List of result dicts (each must have ``"content"``).
            top_k: How many results to return after reranking.
            max_content_chars: Max chars per candidate shown to the LLM.

        Returns:
            A reordered subset of *results* (length ≤ top_k), with an added
            ``_rerank_position`` field indicating original rank before reranking.
        """
        if not results or top_k <= 0:
            return results[:top_k] if results else []
        if self._extraction_llm is None:
            logger.debug("rerank: no extraction_llm configured, returning original order")
            return results[:top_k]

        # Build candidate list for the LLM
        candidates = results[:20]  # cap candidates to avoid token explosion
        numbered: List[str] = []
        for i, item in enumerate(candidates):
            snippet = str(item.get("content") or "").strip()[:max_content_chars]
            if snippet:
                numbered.append(f"{i}. {snippet}")

        if not numbered:
            return results[:top_k]

        system_prompt = (
            "You are a relevance ranker. Given a query and numbered candidate texts, "
            "return ONLY a JSON array of candidate indices ordered by relevance to the query "
            "(most relevant first). Return the indices as integers. Example: [3, 0, 7, 1]\n"
            "Rules:\n"
            "- Return ONLY the JSON array, nothing else.\n"
            "- Include at most {top_k} indices.\n"
            "- Judge relevance by semantic meaning, not surface keyword overlap."
        ).format(top_k=top_k)

        user_content = f"Query: {query}\n\nCandidates:\n" + "\n".join(numbered)

        try:
            raw = self._call_extraction_llm(system_prompt, user_content)
            if not raw:
                return results[:top_k]

            # Parse the JSON array of indices
            raw = raw.strip()
            if raw.startswith("```"):
                raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw).strip()

            indices = json.loads(raw)
            if not isinstance(indices, list):
                logger.warning("rerank: LLM did not return a list, using original order")
                return results[:top_k]

            # Deduplicate and validate indices
            seen: set = set()
            reranked: List[Dict[str, Any]] = []
            for idx in indices:
                idx = int(idx)
                if 0 <= idx < len(candidates) and idx not in seen:
                    seen.add(idx)
                    item = dict(candidates[idx])
                    item["_rerank_position"] = idx
                    reranked.append(item)
                    if len(reranked) >= top_k:
                        break

            return reranked if reranked else results[:top_k]
        except Exception as exc:
            logger.warning("rerank: LLM reranking failed, returning original order: %s", exc)
            return results[:top_k]

    def get_session_history(
        self,
        memory_id: str,
        session_id: str,
        limit: int = 100,
        user_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch the complete, chronological event log for a specific session.

        Unlike retrieve() (vector search), this returns ALL events for the given session_id
        in chronological order — no scoring, no relevance filtering.

        Use when you have a session_id from recall_for_task results and need the full context.

        Args:
            memory_id: Target memory id.
            session_id: The exact session identifier to fetch.
            limit: Max events to return (default 100, max 500).
            user_id: Optional user_id filter for multi-user memories.
        """
        params: Dict[str, Any] = {
            "session_id": session_id,
            "limit": max(1, min(limit, 500)),
        }
        if user_id:
            params["user_id"] = user_id
        payload, resolved_trace_id = self._request_any(
            method="GET",
            path=f"/memories/{memory_id}/content",
            params=params,
            trace_id=trace_id,
        )
        items = payload if isinstance(payload, list) else (payload or {}).get("items", (payload or {}).get("results", []))
        # Sort chronologically
        def _ts(item: Dict[str, Any]) -> str:
            for k in ("aw_time_iso", "event_timestamp", "created_at"):
                v = item.get(k)
                if v:
                    return str(v)
            return ""
        items = sorted(items, key=_ts)
        return self._attach_trace({
            "memory_id": memory_id,
            "session_id": session_id,
            "event_count": len(items),
            "events": items,
        }, resolved_trace_id)

    def remember_step(
        self,
        memory_id: str,
        text: str,
        source: str = "",
        session_id: Optional[str] = None,
        actor: str = "",
        event_type: str = "",
        metadata: Optional[Dict[str, Any]] = None,
        metadata_defaults: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        source_label = self._clean_source(source or self.default_source)
        active_session = self._resolve_session(
            memory_id=memory_id,
            source=source_label,
            session_id=session_id,
            rotate=False,
        )
        body = (text or "").strip()
        if not body:
            raise MemoryCloudError("INVALID_ARGUMENT", "text is required")

        event: Dict[str, Any] = {
            "content": body,
            "source": source_label,
            "session_id": active_session,
            "actor": self._infer_actor(body, actor),
            "event_type": self._infer_event_type(body, event_type),
            "timestamp": self._now_iso(),
        }
        if metadata:
            event["metadata"] = metadata

        result = self.ingest_events(
            memory_id=memory_id,
            events=[event],
            default_source=source_label,
            metadata_defaults=metadata_defaults,
            skip_duplicates=True,
            generate_summary=False,
            user_id=user_id or self._user_id,
            trace_id=trace_id,
        )
        response = {
            "memory_id": memory_id,
            "source": source_label,
            "session_id": active_session,
            "event": event,
            "result": result,
            "extraction_request": result.get("extraction_request") if isinstance(result, dict) else None,
            "trace_id": result.get("trace_id"),
        }
        self._maybe_auto_extract(response, memory_id)
        return response

    def remember_batch(
        self,
        memory_id: str,
        steps: List[Union[str, Dict[str, Any]]],
        source: str = "",
        session_id: Optional[str] = None,
        metadata_defaults: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        source_label = self._clean_source(source or self.default_source)
        active_session = self._resolve_session(
            memory_id=memory_id,
            source=source_label,
            session_id=session_id,
            rotate=False,
        )
        events: List[Dict[str, Any]] = []
        for step in steps:
            normalized = self._normalize_step(step, source=source_label, session_id=active_session)
            if normalized:
                events.append(normalized)

        if not events:
            raise MemoryCloudError("INVALID_ARGUMENT", "no valid steps provided")

        result = self.ingest_events(
            memory_id=memory_id,
            events=events,
            default_source=source_label,
            metadata_defaults=metadata_defaults,
            skip_duplicates=True,
            generate_summary=True,
            user_id=user_id or self._user_id,
            trace_id=trace_id,
        )
        response = {
            "memory_id": memory_id,
            "source": source_label,
            "session_id": active_session,
            "accepted_steps": len(events),
            "result": result,
            "extraction_request": result.get("extraction_request") if isinstance(result, dict) else None,
            "trace_id": result.get("trace_id"),
        }
        self._maybe_auto_extract(response, memory_id)
        return response

    def submit_insights(
        self,
        memory_id: str,
        insights: Dict[str, Any],
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        agent_role: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Submit pre-extracted insights from client-side LLM processing (no server LLM needed).

        Called after processing an extraction_request returned from remember_step/remember_batch.
        The server stores insights with server-side deduplication (zero LLM calls).
        """
        payload: Dict[str, Any] = {**insights}
        if session_id:
            payload["session_id"] = session_id
        if user_id:
            payload["user_id"] = user_id
        if agent_role:
            payload["agent_role"] = agent_role

        data, resolved_trace = self._request(
            method="POST",
            path=f"/memories/{memory_id}/insights/submit",
            json_payload=payload,
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def backfill_conversation_history(
        self,
        memory_id: str,
        history: Union[str, List[str], Dict[str, Any], List[Dict[str, Any]]],
        source: str = "",
        session_id: Optional[str] = None,
        agent_role: str = "",
        metadata_defaults: Optional[Dict[str, Any]] = None,
        generate_summary: bool = True,
        summary_min_new_events: int = 10,
        max_events: int = 800,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        source_label = self._clean_source(source or self.default_source)
        active_session = self._resolve_session(
            memory_id=memory_id,
            source=source_label,
            session_id=session_id,
            rotate=False,
        )

        events = self._coerce_history_to_events(history, source=source_label, session_id=active_session)
        if not events:
            raise MemoryCloudError("INVALID_ARGUMENT", "no parseable history found")

        capped_events = events[: max(1, min(max_events, 5000))]
        merged_defaults = dict(metadata_defaults or {})
        if agent_role.strip() and "agent_role" not in merged_defaults:
            merged_defaults["agent_role"] = agent_role.strip()

        result = self.ingest_events(
            memory_id=memory_id,
            events=capped_events,
            default_source=source_label,
            metadata_defaults=merged_defaults,
            skip_duplicates=True,
            generate_summary=generate_summary,
            summary_min_new_events=max(1, summary_min_new_events),
            trace_id=trace_id,
        )
        return {
            "memory_id": memory_id,
            "source": source_label,
            "session_id": active_session,
            "parsed_events": len(events),
            "ingested_events": len(capped_events),
            "truncated": len(capped_events) < len(events),
            "result": result,
            "trace_id": result.get("trace_id"),
        }

    # ----------------------------
    # Context / Knowledge / Tasks
    # ----------------------------
    def get_session_context(
        self,
        memory_id: str,
        days: int = 7,
        max_cards: int = 10,
        max_tasks: int = 20,
        user_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Load full structured project context at session start. Most token-efficient read.

        Returns recent daily narratives + open tasks + top knowledge cards (<2000 tokens).
        Call at the BEGINNING of every session before doing any work.

        Use instead of recall_for_task when you need a broad overview, not a specific answer.

        Args:
            memory_id: Target memory id.
            days: Days of narrative history to include (1-90, default 7).
            max_cards: Max knowledge cards to include (default 10).
            max_tasks: Max open/in-progress tasks to include (default 20).
            user_id: Optional user filter for multi-user memories.

        Returns:
            {memory_id, generated_at, recent_days, open_tasks, knowledge_cards}
        """
        params: Dict[str, Any] = {"days": days, "max_cards": max_cards, "max_tasks": max_tasks}
        if user_id:
            params["user_id"] = user_id
        data, resolved_trace = self._request(
            method="GET",
            path=f"/memories/{memory_id}/context",
            params=params,
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def get_knowledge_base(
        self,
        memory_id: str,
        query: str = "",
        category: str = "",
        status: str = "",
        limit: int = 20,
        user_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Query structured knowledge cards — decisions, solutions, workflows, pitfalls.

        Use before implementing something to check if a prior solution or decision exists.
        Ideal for enterprise knowledge bases: CRM data, ERP workflows, product docs.

        Args:
            memory_id: Target memory id.
            query: Keyword filter on title/summary (case-insensitive, client-side).
            category: Filter by type. Engineering: problem_solution | decision |
                      workflow | key_point | pitfall | insight.
                      Personal: personal_preference | important_detail |
                      plan_intention | activity_preference | health_info |
                      career_info | custom_misc. Empty = all categories.
            status: Filter by status: open | in_progress | resolved | noted.
                    Empty = all statuses.
            limit: Max cards to return (default 20).
            user_id: Optional user filter for multi-user memories.

        Returns:
            {total, cards: [{category, title, summary, tags, confidence, status}]}
        """
        params: Dict[str, Any] = {"limit": limit}
        if category:
            params["category"] = category
        if status:
            params["status"] = status
        if user_id:
            params["user_id"] = user_id
        data, resolved_trace = self._request(
            method="GET",
            path=f"/memories/{memory_id}/insights/knowledge-cards",
            params=params,
            trace_id=trace_id,
        )
        cards = data.get("cards", [])
        if query:
            q = query.lower()
            cards = [
                c for c in cards
                if q in (c.get("title") or "").lower()
                or q in (c.get("summary") or "").lower()
            ]
        return {"total": len(cards), "cards": cards}

    def get_pending_tasks(
        self,
        memory_id: str,
        priority: str = "",
        limit: int = 30,
        user_id: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Get open and in-progress action items for task pickup or cross-tool handoff.

        Lighter than get_session_context when you only need the task list.
        In-progress tasks are returned first (highest urgency).

        Args:
            memory_id: Target memory id.
            priority: Filter by priority: high | medium | low. Empty = all priorities.
            limit: Max tasks to return (default 30).
            user_id: Optional user filter for multi-user memories.

        Returns:
            {total, in_progress, pending, tasks: [{title, priority, status, detail, context}]}
        """
        params: Dict[str, Any] = {"limit": limit, "status": "pending"}
        if priority:
            params["priority"] = priority
        if user_id:
            params["user_id"] = user_id
        pending_data, _ = self._request(
            method="GET",
            path=f"/memories/{memory_id}/insights/action-items",
            params=params,
            trace_id=trace_id,
        )
        params_ip = dict(params)
        params_ip["status"] = "in_progress"
        inprogress_data, resolved_trace = self._request(
            method="GET",
            path=f"/memories/{memory_id}/insights/action-items",
            params=params_ip,
            trace_id=trace_id,
        )
        pending_items = pending_data.get("action_items", [])
        inprogress_items = inprogress_data.get("action_items", [])
        all_tasks = (inprogress_items + pending_items)[:limit]
        result = {
            "total": len(all_tasks),
            "in_progress": len(inprogress_items),
            "pending": len(pending_items),
            "tasks": [
                {
                    "title": t.get("title"),
                    "priority": t.get("priority"),
                    "status": t.get("status"),
                    "detail": t.get("detail"),
                    "context": t.get("context") or "",
                    "estimated_effort": t.get("estimated_effort") or "medium",
                }
                for t in all_tasks
            ],
        }
        return self._attach_trace(result, resolved_trace)

    def get_handoff_context(
        self,
        memory_id: str,
        current_task: str = "",
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Get a compact structured briefing for resuming work in a new session or tool.

        Use when switching tools (Cursor → Claude Code → Codex) or starting a session
        with zero prior context. The briefing is self-contained — pass it directly to
        another AI agent's system prompt to resume work without re-reading raw history.

        Covers last 3 days (more focused than get_session_context's 7-day view).
        Includes token_estimate so you know the cost before including it in a prompt.

        Args:
            memory_id: Target memory id.
            current_task: The task you want to continue (optional but recommended).

        Returns:
            {memory_id, briefing_for, recent_progress, open_tasks, key_knowledge, token_estimate}
        """
        ctx_data, resolved_trace = self._request(
            method="GET",
            path=f"/memories/{memory_id}/context",
            params={"days": 3, "max_cards": 5, "max_tasks": 10},
            trace_id=trace_id,
        )
        recent_progress = [
            f"{d['date']}: {d['narrative'][:300]}{'...' if len(d.get('narrative', '')) > 300 else ''}"
            for d in ctx_data.get("recent_days", [])
            if d.get("narrative")
        ]
        open_tasks = [
            {"title": t.get("title"), "priority": t.get("priority"), "status": t.get("status")}
            for t in ctx_data.get("open_tasks", [])
        ]
        key_knowledge = [
            {
                "title": c.get("title"),
                "summary": (c.get("summary") or "")[:200]
                + ("..." if len(c.get("summary") or "") > 200 else ""),
            }
            for c in ctx_data.get("knowledge_cards", [])
        ]
        raw_text = str(recent_progress) + str(open_tasks) + str(key_knowledge)
        result = {
            "memory_id": memory_id,
            "briefing_for": current_task or "Continue previous work",
            "recent_progress": recent_progress,
            "open_tasks": open_tasks,
            "key_knowledge": key_knowledge,
            "token_estimate": max(100, len(raw_text) // 4),
        }
        return self._attach_trace(result, resolved_trace)

    def update_task_status(
        self,
        memory_id: str,
        task_id: str,
        status: str,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Update an action item's status.

        Call after completing a task found via get_pending_tasks or get_session_context.
        Always call remember_step first to record what you did, then update_task_status.

        Args:
            memory_id: Target memory id.
            task_id: The task id from get_pending_tasks or get_session_context open_tasks.
            status: New status — "completed" | "in_progress" | "pending".
            trace_id: Optional trace id.

        Returns:
            Updated action item dict with id, title, priority, status, updated_at.
        """
        data, resolved_trace = self._request(
            method="PATCH",
            path=f"/memories/{memory_id}/insights/action-items/{task_id}",
            json_payload={"status": status},
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def detect_agent_role(
        self,
        memory_id: str,
        content: str,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Auto-detect agent role from content using LLM.

        When a memory has multiple agent_profiles configured, this endpoint
        analyses the provided content and returns the most likely role.

        Args:
            memory_id: Target memory id.
            content: The text to analyse for role detection.
            trace_id: Optional trace id.

        Returns:
            {detected_role, confidence, available_roles}
        """
        data, resolved_trace = self._request(
            method="POST",
            path=f"/memories/{memory_id}/detect-role",
            json_payload={"query": content},
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def list_agents(
        self,
        memory_id: str,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """List all agent profiles configured for this memory, with activation prompts.

        Returns enriched agent profiles that include auto-generated
        ``system_prompt`` and ``activation_prompt`` fields.  These prompts
        can be used to spawn sub-agents (e.g. via Claude Code's Agent tool).

        Args:
            memory_id: Target memory id.
            trace_id: Optional trace id.

        Returns:
            {agents: [AgentProfile, ...], total: int}
        """
        data, resolved_trace = self._request(
            method="GET",
            path=f"/memories/{memory_id}/agents",
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def get_agent_prompt(
        self,
        memory_id: str,
        agent_role: str,
        trace_id: Optional[str] = None,
    ) -> Optional[str]:
        """Get the activation prompt for a specific agent role.

        Convenience wrapper around :meth:`list_agents` that returns the
        ``activation_prompt`` for the given *agent_role*, or ``None`` if
        the role is not found.

        Args:
            memory_id: Target memory id.
            agent_role: The agent_role code to look up.
            trace_id: Optional trace id.

        Returns:
            The activation prompt string, or None.
        """
        data = self.list_agents(memory_id, trace_id=trace_id)
        for agent in data.get("agents", []):
            if agent.get("agent_role") == agent_role:
                return agent.get("activation_prompt") or agent.get("system_prompt")
        return None

    def get_memory_users(
        self,
        memory_id: str,
        limit: int = 50,
        offset: int = 0,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        List users who contributed to this memory.

        Returns a paginated list of distinct user_id values found in the
        memory's vector store and insight tables.

        Args:
            memory_id: Target memory id.
            limit: Max users to return (default 50).
            offset: Pagination offset (default 0).
            trace_id: Optional trace id.

        Returns:
            {users: [...], total: int}
        """
        params: Dict[str, Any] = {"limit": limit, "offset": offset}
        data, resolved_trace = self._request(
            method="GET",
            path=f"/memories/{memory_id}/users",
            params=params,
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    # ----------------------------
    # Insights / Jobs / Upload
    # ----------------------------
    def insights(
        self,
        memory_id: str,
        query: Optional[str] = None,
        limit: int = 120,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload, resolved_trace_id = self._request(
            method="POST",
            path="/insights/memory",
            json_payload={
                "memory_id": memory_id,
                "query": query,
                "limit": limit,
            },
            trace_id=trace_id,
        )
        return self._attach_trace(payload, resolved_trace_id)

    def get_async_job_status(self, job_id: str, trace_id: Optional[str] = None) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="GET",
            path=f"/jobs/{job_id}",
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def upload_file(
        self,
        memory_id: str,
        file_path: str,
        filename: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not os.path.exists(file_path):
            raise MemoryCloudError("INVALID_ARGUMENT", f"File not found: {file_path}")

        upload_name = filename or os.path.basename(file_path)
        url = f"{self.base_url}/memories/{memory_id}/upload_file"
        headers = self._headers(trace_id=trace_id, idempotency_key=None, include_json_content_type=False)

        for attempt in range(self.max_retries + 1):
            try:
                with open(file_path, "rb") as fp:
                    response = self.session.request(
                        method="POST",
                        url=url,
                        files={"file": (upload_name, fp)},
                        headers=headers,
                        timeout=self.timeout,
                    )
            except requests.RequestException as exc:
                if attempt >= self.max_retries:
                    raise MemoryCloudError("NETWORK_ERROR", str(exc)) from exc
                self._sleep(attempt)
                continue

            resolved_trace = self._extract_trace_id(response, fallback=trace_id)
            if response.status_code >= 400:
                if response.status_code in RETRYABLE_STATUSES and attempt < self.max_retries:
                    self._sleep(attempt)
                    continue
                raise self._build_error(response, resolved_trace)

            payload = self._decode_json(response)
            if not isinstance(payload, dict):
                payload = {"data": payload}
            return self._attach_trace(payload, resolved_trace)

        raise MemoryCloudError("INTERNAL", "Upload failed unexpectedly")

    def get_upload_job_status(
        self,
        memory_id: str,
        upload_job_id: str,
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="GET",
            path=f"/memories/{memory_id}/upload_jobs/{upload_job_id}",
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    # ----------------------------
    # Export
    # ----------------------------
    def export_memory_package(
        self,
        memory_id: str,
        payload: Dict[str, Any],
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        response, resolved_trace = self._request_response(
            method="POST",
            path=f"/memories/{memory_id}/export",
            json_payload=payload,
            trace_id=trace_id,
        )
        filename = self._extract_filename(
            response.headers.get("Content-Disposition"),
            fallback=f"memory_{memory_id}_{payload.get('package_type', 'export')}.zip",
        )
        data = {
            "filename": filename,
            "content_type": response.headers.get("Content-Type") or "application/zip",
            "bytes": response.content,
        }
        return self._attach_trace(data, resolved_trace)

    def save_export_memory_package(
        self,
        memory_id: str,
        payload: Dict[str, Any],
        output_path: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> str:
        exported = self.export_memory_package(memory_id=memory_id, payload=payload, trace_id=trace_id)
        filename = str(exported.get("filename") or f"memory_{memory_id}_export.zip")
        target = output_path or filename
        with open(target, "wb") as fp:
            fp.write(exported.get("bytes") or b"")
        return target

    # ----------------------------
    # API Keys / Wizard
    # ----------------------------
    def create_api_key(self, owner_id: str, name: str = "Default Key", trace_id: Optional[str] = None) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="POST",
            path="/apikeys",
            json_payload={"owner_id": owner_id, "name": name},
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def list_api_keys(self, owner_id: str, trace_id: Optional[str] = None) -> List[Dict[str, Any]]:
        data, _ = self._request_any(
            method="GET",
            path="/apikeys",
            params={"owner_id": owner_id},
            trace_id=trace_id,
        )
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    def revoke_api_key(self, owner_id: str, key_id: str, trace_id: Optional[str] = None) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="DELETE",
            path=f"/apikeys/{key_id}",
            params={"owner_id": owner_id},
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    def memory_wizard(
        self,
        owner_id: str,
        messages: List[Dict[str, Any]],
        draft: Optional[Dict[str, Any]] = None,
        locale: str = "en",
        trace_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        data, resolved_trace = self._request(
            method="POST",
            path="/wizard/memory_designer",
            json_payload={
                "owner_id": owner_id,
                "messages": messages,
                "draft": draft or {},
                "locale": locale,
            },
            trace_id=trace_id,
        )
        return self._attach_trace(data, resolved_trace)

    # ----------------------------
    # Internal HTTP helpers
    # ----------------------------
    def _request(
        self,
        method: str,
        path: str,
        json_payload: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> Tuple[Dict[str, Any], Optional[str]]:
        response, resolved_trace = self._request_response(
            method=method,
            path=path,
            json_payload=json_payload,
            params=params,
            trace_id=trace_id,
            idempotency_key=idempotency_key,
            extra_headers=extra_headers,
        )
        payload = self._decode_json(response)
        if not isinstance(payload, dict):
            payload = {"data": payload}
        return payload, resolved_trace

    def _request_any(
        self,
        method: str,
        path: str,
        json_payload: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Tuple[Any, Optional[str]]:
        response, resolved_trace = self._request_response(
            method=method,
            path=path,
            json_payload=json_payload,
            params=params,
            trace_id=trace_id,
            idempotency_key=idempotency_key,
        )
        return self._decode_json(response), resolved_trace

    def _request_response(
        self,
        method: str,
        path: str,
        json_payload: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        trace_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        stream: bool = False,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> Tuple[requests.Response, Optional[str]]:
        url = f"{self.base_url}{path}"
        headers = self._headers(trace_id=trace_id, idempotency_key=idempotency_key)
        if extra_headers:
            headers.update(extra_headers)

        for attempt in range(self.max_retries + 1):
            try:
                response = self.session.request(
                    method=method,
                    url=url,
                    json=json_payload,
                    params=params,
                    headers=headers,
                    timeout=self.timeout,
                    stream=stream,
                )
            except requests.RequestException as exc:
                if attempt >= self.max_retries:
                    raise MemoryCloudError("NETWORK_ERROR", str(exc)) from exc
                self._sleep(attempt)
                continue

            resolved_trace_id = self._extract_trace_id(response, fallback=trace_id)
            if response.status_code >= 400:
                if response.status_code in RETRYABLE_STATUSES and attempt < self.max_retries:
                    self._sleep(attempt)
                    continue
                raise self._build_error(response, resolved_trace_id)

            return response, resolved_trace_id

        raise MemoryCloudError("INTERNAL", "Request failed unexpectedly")

    def _headers(
        self,
        trace_id: Optional[str],
        idempotency_key: Optional[str],
        include_json_content_type: bool = True,
    ) -> Dict[str, str]:
        headers = {
            "Accept": "application/json",
        }
        if include_json_content_type:
            headers["Content-Type"] = "application/json"
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if trace_id:
            headers["X-Trace-Id"] = trace_id
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return headers

    def _extract_trace_id(self, response: requests.Response, fallback: Optional[str] = None) -> Optional[str]:
        return response.headers.get("X-Trace-Id") or response.headers.get("X-Request-Id") or fallback

    def _sleep(self, attempt: int) -> None:
        delay = self.backoff_seconds * (2 ** attempt)
        if delay > 0:
            time.sleep(delay)

    def _decode_json(self, response: requests.Response) -> Any:
        if not response.text:
            return {}
        try:
            return response.json()
        except ValueError:
            return {"raw": response.text}

    def _build_error(self, response: requests.Response, trace_id: Optional[str]) -> MemoryCloudError:
        payload = self._decode_json(response)
        code = self._default_code(response.status_code)
        message = str(payload)
        if isinstance(payload, dict):
            if isinstance(payload.get("error"), dict):
                code = str(payload["error"].get("code") or code)
                message = str(payload["error"].get("message") or message)
            elif payload.get("detail"):
                message = str(payload["detail"])
        return MemoryCloudError(
            code=code,
            message=message,
            status_code=response.status_code,
            trace_id=trace_id,
            payload=payload if isinstance(payload, dict) else {"payload": payload},
        )

    def _default_code(self, status_code: int) -> str:
        if status_code == 400:
            return "INVALID_ARGUMENT"
        if status_code == 401:
            return "UNAUTHENTICATED"
        if status_code == 403:
            return "PERMISSION_DENIED"
        if status_code == 404:
            return "NOT_FOUND"
        if status_code == 409:
            return "CONFLICT"
        if status_code == 429:
            return "RATE_LIMITED"
        if status_code == 408:
            return "TIMEOUT"
        if status_code >= 500:
            return "INTERNAL"
        return "UNKNOWN_ERROR"

    def _attach_trace(self, payload: Dict[str, Any], trace_id: Optional[str]) -> Dict[str, Any]:
        if trace_id and "trace_id" not in payload:
            data = dict(payload)
            data["trace_id"] = trace_id
            return data
        return payload

    # ----------------------------
    # MCP helper internals
    # ----------------------------
    def _clean_source(self, source: Optional[str]) -> str:
        raw = (source or self.default_source).strip() or self.default_source
        cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", raw).strip("-")
        return cleaned or self.default_source

    def _build_session_id(self, memory_id: str, source: str) -> str:
        short_memory = (memory_id or "memory")[:8]
        ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        return f"{self.session_prefix}-{source}-{short_memory}-{ts}-{uuid.uuid4().hex[:6]}"

    def _resolve_session(
        self,
        memory_id: str,
        source: str,
        session_id: Optional[str] = None,
        rotate: bool = False,
    ) -> str:
        explicit = (session_id or "").strip()
        if explicit:
            self._session_cache[memory_id] = explicit
            return explicit
        cached = self._session_cache.get(memory_id)
        if cached and not rotate:
            return cached
        generated = self._build_session_id(memory_id, source)
        self._session_cache[memory_id] = generated
        return generated

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _infer_actor(self, text: str, explicit: Optional[str] = None) -> str:
        if explicit and str(explicit).strip():
            return str(explicit).strip()
        lowered = text.strip().lower()
        if lowered.startswith(("user:", "human:")):
            return "user"
        if lowered.startswith(("assistant:", "ai:", "model:")):
            return "assistant"
        return "assistant"

    def _infer_event_type(self, text: str, explicit: Optional[str] = None) -> str:
        if explicit and str(explicit).strip():
            return str(explicit).strip()
        lowered = text.lower()
        if any(token in lowered for token in ["diff", "patch", "+++ ", "--- ", "@@ ", "file:", "refactor", "updated"]):
            return "file_diff"
        if any(token in lowered for token in ["tool", "command", "terminal", "exec ", "ran ", "playwright", "pytest", "test run"]):
            return "tool_call"
        if any(token in lowered for token in ["todo", "next:", "remaining", "blocker", "follow-up"]):
            return "planning"
        if any(token in lowered for token in ["error", "exception", "traceback", "failed", "bug"]):
            return "issue"
        return "message"

    def _normalize_step(
        self,
        step: Union[str, Dict[str, Any]],
        source: str,
        session_id: str,
    ) -> Dict[str, Any]:
        if isinstance(step, str):
            text = step.strip()
            if not text:
                return {}
            return {
                "content": text,
                "source": source,
                "session_id": session_id,
                "actor": self._infer_actor(text),
                "event_type": self._infer_event_type(text),
                "timestamp": self._now_iso(),
            }

        if not isinstance(step, dict):
            return {}

        text = ""
        for key in ("content", "text", "message", "body", "output", "input"):
            value = step.get(key)
            if value is not None and str(value).strip():
                text = str(value).strip()
                break
        if not text:
            return {}

        event = dict(step)
        event["content"] = text
        event.setdefault("source", source)
        event.setdefault("session_id", session_id)
        event.setdefault("actor", self._infer_actor(text, event.get("actor")))
        event.setdefault("event_type", self._infer_event_type(text, event.get("event_type")))
        event.setdefault("timestamp", self._now_iso())
        return event

    def _events_from_transcript_text(self, transcript: str, source: str, session_id: str) -> List[Dict[str, Any]]:
        lines = [line.strip() for line in transcript.splitlines() if line.strip()]
        output: List[Dict[str, Any]] = []
        for line in lines:
            normalized = self._normalize_step(line, source=source, session_id=session_id)
            if normalized:
                output.append(normalized)
        return output

    def _coerce_history_to_events(
        self,
        history: Union[str, List[str], Dict[str, Any], List[Dict[str, Any]]],
        source: str,
        session_id: str,
    ) -> List[Dict[str, Any]]:
        if isinstance(history, str):
            stripped = history.strip()
            if not stripped:
                return []
            if stripped[:1] in {"[", "{"}:
                try:
                    parsed = json.loads(stripped)
                    return self._coerce_history_to_events(parsed, source=source, session_id=session_id)  # type: ignore[arg-type]
                except Exception:
                    pass
            return self._events_from_transcript_text(stripped, source=source, session_id=session_id)

        if isinstance(history, dict):
            if isinstance(history.get("events"), list):
                return self._coerce_history_to_events(history["events"], source=source, session_id=session_id)  # type: ignore[arg-type]
            if isinstance(history.get("messages"), list):
                return self._coerce_history_to_events(history["messages"], source=source, session_id=session_id)  # type: ignore[arg-type]
            normalized = self._normalize_step(history, source=source, session_id=session_id)
            return [normalized] if normalized else []

        if isinstance(history, list):
            events: List[Dict[str, Any]] = []
            for item in history:
                if isinstance(item, str):
                    if "\n" in item:
                        events.extend(self._events_from_transcript_text(item, source=source, session_id=session_id))
                    else:
                        normalized = self._normalize_step(item, source=source, session_id=session_id)
                        if normalized:
                            events.append(normalized)
                elif isinstance(item, dict):
                    normalized = self._normalize_step(item, source=source, session_id=session_id)
                    if normalized:
                        events.append(normalized)
            return events

        return []

    # ----------------------------
    # Utility
    # ----------------------------
    def _extract_filename(self, content_disposition: Optional[str], fallback: str) -> str:
        if not content_disposition:
            return fallback
        utf8_match = re.search(r"filename\*=UTF-8''([^;]+)", content_disposition, flags=re.IGNORECASE)
        if utf8_match:
            value = utf8_match.group(1).strip().strip('"').strip("'")
            try:
                from urllib.parse import unquote

                return unquote(value)
            except Exception:
                return value
        basic_match = re.search(r'filename="?([^\";]+)"?', content_disposition, flags=re.IGNORECASE)
        if basic_match:
            return basic_match.group(1).strip()
        return fallback

    def _safe_json_loads(self, text: str) -> Any:
        try:
            return json.loads(text)
        except Exception:
            return {"raw": text}

    # ------------------------------------------------------------------
    # Auto-extraction (background, non-blocking)
    # ------------------------------------------------------------------

    def _maybe_auto_extract(self, result: Dict[str, Any], memory_id: str) -> None:
        """If extraction_request is present and auto-extraction is enabled, process in background."""
        if not self.enable_extraction or self._extraction_llm is None:
            return
        extraction_req = result.get("extraction_request")
        if not extraction_req or not isinstance(extraction_req, dict):
            return
        session_id = result.get("session_id", "")
        t = threading.Thread(
            target=self._run_extraction,
            args=(extraction_req, memory_id, session_id),
            daemon=True,
        )
        t.start()

    def _run_extraction(self, extraction_req: Dict[str, Any], memory_id: str, session_id: str) -> None:
        """Call the user's LLM to extract insights, then submit them."""
        try:
            system_prompt = extraction_req.get("system_prompt", "")
            events = extraction_req.get("events", [])
            existing_cards = extraction_req.get("existing_cards", [])

            cards_json = json.dumps(existing_cards, indent=2, ensure_ascii=False) if existing_cards else "[]"
            filled_prompt = system_prompt.replace("{existing_cards}", cards_json)

            compact = _compact_events(events)
            user_content = json.dumps({"events": compact}, ensure_ascii=False)

            text = self._call_extraction_llm(filled_prompt, user_content)
            if not text:
                return

            try:
                insights = _parse_insights_json(text)
            except Exception:
                logger.warning("Extraction JSON parse failed, retrying with stricter prompt")
                retry_prompt = (
                    "Return one valid JSON object only. "
                    "No markdown, no code fence, no extra commentary. "
                    "Required keys: knowledge_cards, risks, action_items.\n\n"
                    + filled_prompt
                )
                retry_text = self._call_extraction_llm(retry_prompt, json.dumps({"events": compact[:8]}, ensure_ascii=False))
                if not retry_text:
                    return
                insights = _parse_insights_json(retry_text)

            turn_brief = insights.pop("turn_brief", None)
            insights = _normalize_insights(insights)

            self.submit_insights(
                memory_id=memory_id,
                insights=insights,
                session_id=session_id,
                user_id=self._user_id,
                agent_role=self._agent_role,
            )
            logger.info(
                "Auto-extraction complete: %d cards, %d risks, %d actions",
                len(insights.get("knowledge_cards", [])),
                len(insights.get("risks", [])),
                len(insights.get("action_items", [])),
            )

            if turn_brief and isinstance(turn_brief, str) and turn_brief.strip():
                try:
                    self.remember_step(
                        memory_id=memory_id,
                        text=turn_brief.strip(),
                        session_id=session_id,
                        actor="system",
                        event_type="turn_brief",
                        user_id=self._user_id,
                    )
                except Exception as e:
                    logger.warning("Turn brief storage failed: %s", e)
        except Exception as e:
            logger.warning("Background auto-extraction failed: %s", e, exc_info=True)

    def _call_extraction_llm(self, system_prompt: str, user_content: str) -> str:
        """Call the user's LLM for extraction. Returns raw text response."""
        llm = self._extraction_llm
        if self._llm_type == "openai":
            model = self._extraction_model or "gpt-4o-mini"
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ]
            try:
                response = llm.chat.completions.create(
                    model=model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0,
                    max_tokens=self._extraction_max_tokens,
                )
            except Exception as exc:
                if "response_format" not in str(exc).lower():
                    raise
                response = llm.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": "Return one valid JSON object only. No markdown, no code fence."},
                        *messages,
                    ],
                    temperature=0,
                    max_tokens=self._extraction_max_tokens,
                )
            choices = getattr(response, "choices", None) or []
            if choices:
                msg = getattr(choices[0], "message", None)
                if msg:
                    return getattr(msg, "content", "") or ""
            return ""
        elif self._llm_type == "anthropic":
            model = self._extraction_model or "claude-haiku-4-5-20251001"
            response = llm.messages.create(
                model=model,
                max_tokens=self._extraction_max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_content}],
                temperature=0,
            )
            blocks = getattr(response, "content", None) or []
            texts = [getattr(b, "text", "") for b in blocks if getattr(b, "type", "") == "text"]
            return " ".join(texts)
        else:
            logger.warning("Unknown LLM type for extraction: %s", self._llm_type)
            return ""


# ---------------------------------------------------------------------------
# Module-level helpers for extraction
# ---------------------------------------------------------------------------

def _detect_llm_type(llm: Any) -> Optional[str]:
    """Detect whether the LLM client is OpenAI or Anthropic."""
    cls_name = type(llm).__module__ + "." + type(llm).__qualname__
    if "openai" in cls_name.lower():
        return "openai"
    if "anthropic" in cls_name.lower():
        return "anthropic"
    # Duck-type check
    if hasattr(llm, "chat") and hasattr(getattr(llm, "chat"), "completions"):
        return "openai"
    if hasattr(llm, "messages") and hasattr(getattr(llm, "messages"), "create"):
        return "anthropic"
    return None


def _coerce_json_text(text: str) -> str:
    """Extract a JSON object from LLM output using brace-depth matching."""
    raw = (text or "").strip()
    if not raw:
        return raw
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
    if raw.startswith("{") and raw.endswith("}"):
        return raw
    start = raw.find("{")
    if start == -1:
        return raw
    depth = 0
    in_str = False
    esc = False
    for i, ch in enumerate(raw[start:], start):
        if esc:
            esc = False
            continue
        if ch == "\\" and in_str:
            esc = True
            continue
        if ch == '"':
            in_str = not in_str
        elif not in_str:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return raw[start:i + 1]
    return raw[start:]


def _parse_insights_json(text: str) -> Dict[str, Any]:
    """Parse JSON from LLM output, tolerating markdown fences and Python literals."""
    normalized = _coerce_json_text(text)
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        try:
            parsed = ast.literal_eval(normalized)
        except (ValueError, SyntaxError, TypeError) as e:
            raise ValueError("Invalid extraction payload") from e
    if not isinstance(parsed, dict):
        raise ValueError("Extraction payload must be a JSON object")
    return parsed


_MIN_EVENT_CHARS = 8


def _compact_events(
    events: List[Dict[str, Any]],
    max_events: int = 12,
    max_chars_per_event: int = 480,
    max_total_chars: int = 3600,
) -> List[str]:
    """Compact events for extraction LLM input.

    Events shorter than ``_MIN_EVENT_CHARS`` are dropped — they carry no
    substantive information (e.g. "ok", "hi", heartbeat pings).
    """
    compacted: List[str] = []
    total = 0
    for event in events[:max_events]:
        text = str(event.get("content", "")).strip()
        if len(text) < _MIN_EVENT_CHARS:
            continue
        text = text[:max_chars_per_event]
        if total + len(text) > max_total_chars:
            break
        compacted.append(text)
        total += len(text)
    return compacted


def _normalize_insights(insights: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure insights has the expected structure."""
    result: Dict[str, Any] = {}
    for key in ("knowledge_cards", "risks", "action_items"):
        val = insights.get(key)
        if isinstance(val, list):
            result[key] = val
        else:
            result[key] = []
    return result
