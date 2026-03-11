"""Base adapter class for all Awareness Memory Cloud integrations.

Provides shared logic: session management, memory retrieval, background storage,
client-side insight extraction, tool function definitions, and error handling.

Framework-specific adapters inherit from this and add their own injection methods.
"""

import ast
import json
import logging
import os
import re
import threading
from typing import Any, Callable, Dict, List, Optional

from memory_cloud.client import MemoryCloudClient
from memory_cloud.query_rewrite import build_retrieve_queries, extract_keywords

logger = logging.getLogger(__name__)

_DEFAULT_EXTRACTION_MAX_TOKENS = 16384

_MEMORY_BLOCK_START = "[Relevant memories]"
_MEMORY_BLOCK_END = "[End memories]"
_MEMORY_BLOCK_RE = re.compile(
    r"\[Relevant memories\].*?\[End memories\]\n*",
    flags=re.DOTALL,
)


def _extract_last_user_text(messages: List[Dict[str, Any]]) -> str:
    """Extract the last user message text from OpenAI-format messages."""
    for msg in reversed(messages):
        if isinstance(msg, dict) and msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                texts = [
                    p.get("text", "")
                    for p in content
                    if isinstance(p, dict) and p.get("type") == "text"
                ]
                return " ".join(texts)
    return ""


def _coerce_json_object_text(text: str) -> str:
    """Extract a JSON object from plain-text/markdown model output.

    Uses brace-depth matching instead of greedy regex to correctly handle
    cases where the LLM adds explanatory text around the JSON object.
    """
    raw = (text or "").strip()
    if not raw:
        return raw
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
    if raw.startswith("{") and raw.endswith("}"):
        return raw
    # Brace-depth matching: find the first top-level { ... } block
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
    # Fallback: return from first brace to end (incomplete JSON, let parser handle)
    return raw[start:]


def _parse_insights_payload(text: str) -> Dict[str, Any]:
    """Parse strict JSON first, then tolerate Python-literal dict output."""
    normalized = _coerce_json_object_text(text)
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        try:
            parsed = ast.literal_eval(normalized)
        except (ValueError, SyntaxError, TypeError) as lit_err:
            raise ValueError("Invalid extraction payload: model did not return a valid JSON object") from lit_err
    if not isinstance(parsed, dict):
        raise ValueError("LLM extraction payload must be an object")
    return parsed


def _compact_events_for_extraction(
    events: List[Dict[str, Any]],
    *,
    max_events: int = 12,
    max_chars_per_event: int = 480,
    max_total_chars: int = 3600,
) -> List[str]:
    compacted: List[str] = []
    total = 0
    for event in events[:max_events]:
        raw = event.get("content", "")
        text = str(raw).strip()
        if not text:
            continue
        text = text[:max_chars_per_event]
        if total + len(text) > max_total_chars:
            break
        compacted.append(text)
        total += len(text)
    return compacted


class MemoryCloudBaseAdapter:
    """Base adapter with shared memory operations.

    Subclasses should override `_default_source` and implement framework-specific
    injection methods (e.g. inject_into_agent, wrap_crew, etc.).
    """

    _default_source: str = "awareness"

    def __init__(
        self,
        client: MemoryCloudClient,
        memory_id: str,
        *,
        source: Optional[str] = None,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        agent_role: Optional[str] = None,
        retrieve_limit: int = 8,
        max_context_chars: int = 4000,
        min_relevance_score: float = 0.5,
        max_inject_items: int = 5,
        auto_remember: bool = True,
        enable_extraction: bool = True,
        extraction_model: Optional[str] = None,
        extraction_max_tokens: Optional[int] = None,
        extraction_callback: Optional[Callable[[str, str, str], str]] = None,
        query_rewrite: str = "rule",  # "none" | "rule" | "llm"
        on_error: str = "warn",
    ):
        self.client = client
        self.memory_id = memory_id
        self.source = source or self._default_source
        self.user_id = user_id
        self.agent_role = agent_role
        self.retrieve_limit = retrieve_limit
        self.max_context_chars = max_context_chars
        self.min_relevance_score = min_relevance_score
        self.max_inject_items = max_inject_items
        self.auto_remember = auto_remember
        self.enable_extraction = enable_extraction
        self.extraction_model = extraction_model or os.getenv(
            "AWARENESS_EXTRACTION_MODEL",
            "gpt-4o-mini",
        )
        self.extraction_max_tokens = (
            extraction_max_tokens
            or int(os.getenv("AWARENESS_EXTRACTION_MAX_TOKENS", "0"))
            or _DEFAULT_EXTRACTION_MAX_TOKENS
        )
        self.extraction_callback = extraction_callback
        self.query_rewrite = query_rewrite
        self.on_error = on_error

        if session_id:
            self._session_id = session_id
        else:
            result = client.begin_memory_session(
                memory_id=memory_id,
                source=self.source,
            )
            self._session_id = result["session_id"]

    @property
    def session_id(self) -> str:
        return self._session_id

    # ------------------------------------------------------------------
    # Core memory operations
    # ------------------------------------------------------------------

    def _build_metadata_filter(self) -> Optional[Dict[str, Any]]:
        f: Dict[str, Any] = {}
        if self.user_id:
            f["user_id"] = self.user_id
        if self.agent_role:
            f["agent_role"] = self.agent_role
        return f if f else None

    def _retrieve_context_from_messages(self, messages: List[Dict[str, Any]]) -> str:
        """Retrieve relevant memories using context-aware query rewriting."""
        use_llm = self.query_rewrite == "llm"
        llm_fn = self._make_rewrite_llm_fn() if use_llm else None

        semantic_query, keyword_query = build_retrieve_queries(
            messages,
            llm_fn=llm_fn,
            use_llm_rewrite=use_llm,
        )
        return self._retrieve_context(semantic_query, keyword_query=keyword_query)

    def _make_rewrite_llm_fn(self) -> Optional[Callable[..., str]]:
        """Create a lightweight LLM callable for query rewriting."""
        if self.extraction_callback:
            model = self.extraction_model

            def _call(system_prompt: str, user_content: str) -> str:
                return self.extraction_callback(model, system_prompt, user_content)

            return _call

        try:
            import openai as _oai
            oai_client = _oai.OpenAI()
            model = self.extraction_model

            def _call_openai(system_prompt: str, user_content: str) -> str:
                resp = oai_client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    temperature=0,
                    max_tokens=120,
                )
                return (resp.choices[0].message.content or "") if resp.choices else ""

            return _call_openai
        except Exception:
            return None

    def _retrieve_context(self, query: str, *, keyword_query: str = "") -> str:
        """Retrieve relevant memories and format as context string."""
        if not query.strip():
            return ""
        try:
            result = self.client.retrieve(
                memory_id=self.memory_id,
                query=query,
                keyword_query=keyword_query or None,
                limit=self.retrieve_limit,
                metadata_filter=self._build_metadata_filter(),
            )
            items = result.get("results", [])
            if not items:
                return ""
            # Filter by relevance score and cap inject count
            items = [
                item for item in items
                if item.get("score") is None or item.get("score", 0) >= self.min_relevance_score
            ]
            items = items[:self.max_inject_items]
            if not items:
                return ""
            parts: List[str] = []
            total = 0
            for item in items:
                content = str(item.get("content", ""))
                if total + len(content) > self.max_context_chars:
                    break
                parts.append(content)
                total += len(content)
            if not parts:
                return ""
            return (
                f"{_MEMORY_BLOCK_START}\n"
                + "\n---\n".join(parts)
                + f"\n{_MEMORY_BLOCK_END}\n\n"
            )
        except Exception as e:
            self._handle_error(f"Memory retrieval failed: {e}")
            return ""

    def _store_in_background(
        self,
        text: str,
        actor: str = "assistant",
        event_type: str = "message",
    ) -> None:
        """Store text as a memory event in a background thread."""
        if not self.auto_remember or not text.strip():
            return

        def _store():
            try:
                result = self.client.remember_step(
                    memory_id=self.memory_id,
                    text=text,
                    source=self.source,
                    session_id=self._session_id,
                    actor=actor,
                    event_type=event_type,
                    user_id=self.user_id,
                )
                if (
                    self.enable_extraction
                    and isinstance(result, dict)
                    and "extraction_request" in result
                ):
                    self._run_extraction(result["extraction_request"])
            except Exception as e:
                logger.warning(f"Background memory storage failed: {e}")

        thread = threading.Thread(target=_store, daemon=True)
        thread.start()

    def _run_extraction(self, extraction_request: Dict[str, Any]) -> None:
        """Call an LLM to extract insights from events, then submit to server."""
        try:
            system_prompt = extraction_request.get("system_prompt", "")
            events = extraction_request.get("events", [])
            existing_cards = extraction_request.get("existing_cards", [])
            cards_json = (
                json.dumps(existing_cards, indent=2, ensure_ascii=False)
                if existing_cards
                else "[]"
            )
            filled_prompt = system_prompt.replace("{existing_cards}", cards_json)
            compact_events = _compact_events_for_extraction(events)
            user_content = json.dumps(
                {"events": compact_events},
                ensure_ascii=False,
            )

            text = self._call_extraction_llm(filled_prompt, user_content)
            if not text:
                return

            try:
                parsed = _parse_insights_payload(text)
            except Exception as parse_err:
                logger.warning(f"Extraction payload parse failed, retrying with stricter JSON prompt: {parse_err}")
                retry_prompt = (
                    "Return one valid JSON object only. "
                    "Do not include markdown/code fences/explanations. "
                    "Required keys: knowledge_cards, risks, action_items.\n\n"
                    + filled_prompt
                )
                retry_content = json.dumps(
                    {"events": compact_events[:8]},
                    ensure_ascii=False,
                )
                retry_text = self._call_extraction_llm(retry_prompt, retry_content)
                if not retry_text:
                    return
                parsed = _parse_insights_payload(retry_text)

            # Extract turn_brief before normalization
            turn_brief = parsed.pop("turn_brief", None)

            insights = _normalize_insights_payload(parsed)
            self.client.submit_insights(
                memory_id=self.memory_id,
                insights=insights,
                session_id=extraction_request.get("session_id", self._session_id),
                user_id=self.user_id,
                agent_role=self.agent_role,
            )
            logger.info(
                f"Extraction complete: "
                f"{len(insights.get('knowledge_cards', []))} cards, "
                f"{len(insights.get('risks', []))} risks, "
                f"{len(insights.get('action_items', []))} actions"
            )

            # Store turn_brief as a special event for DAILY_NARRATIVE write-through
            if turn_brief and isinstance(turn_brief, str) and turn_brief.strip():
                try:
                    self.client.remember_step(
                        memory_id=self.memory_id,
                        text=turn_brief.strip(),
                        source=self.source,
                        session_id=extraction_request.get("session_id", self._session_id),
                        actor="system",
                        event_type="turn_brief",
                        user_id=self.user_id,
                    )
                    logger.info("Turn brief stored: %s", turn_brief[:80])
                except Exception as tb_exc:
                    logger.warning(f"Turn brief storage failed: {tb_exc}")
        except json.JSONDecodeError as e:
            logger.warning(f"Extraction LLM returned invalid JSON: {e}")
        except Exception as e:
            logger.warning(f"Background extraction failed: {e}", exc_info=True)

    def _call_extraction_llm(self, system_prompt: str, user_content: str) -> str:
        """Call an LLM for extraction. Subclasses can override for custom LLM routing.

        Default: tries OpenAI gpt-4o-mini.
        """
        if self.extraction_callback:
            return self.extraction_callback(self.extraction_model, system_prompt, user_content)
        try:
            import openai as _oai

            oai_client = _oai.OpenAI()
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ]
            try:
                response = oai_client.chat.completions.create(
                    model=self.extraction_model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0,
                    max_tokens=self.extraction_max_tokens,
                )
            except Exception as exc:
                if "response_format" not in str(exc).lower():
                    raise
                response = oai_client.chat.completions.create(
                    model=self.extraction_model,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "Return one valid JSON object only. "
                                "No markdown, no code fence, no extra commentary."
                            ),
                        },
                        *messages,
                    ],
                    temperature=0,
                    max_tokens=self.extraction_max_tokens,
                )
            return (response.choices[0].message.content or "") if response.choices else ""
        except Exception:
            logger.debug("OpenAI not available for extraction, skipping")
            return ""

    # ------------------------------------------------------------------
    # Shared tool methods
    # ------------------------------------------------------------------

    def memory_search(
        self,
        query: str,
        recall_mode: str = "hybrid",
        limit: int = 8,
    ) -> str:
        """Search memory for relevant context.

        Args:
            query: Semantic search query.
            recall_mode: One of precise, session, structured, hybrid, auto.
            limit: Max results to return.

        Returns:
            JSON string with search results.
        """
        try:
            data = self.client.retrieve(
                memory_id=self.memory_id,
                query=query,
                limit=limit,
                recall_mode=recall_mode,
                metadata_filter=self._build_metadata_filter(),
            )
            return json.dumps(data.get("results", []), ensure_ascii=False)
        except Exception as exc:
            return f"Error searching memory: {exc}"

    def memory_write(
        self,
        content: str,
        event_type: str = "note",
    ) -> str:
        """Write content to memory.

        Args:
            content: Text content to store.
            event_type: Type of event (note, message, decision, etc.).

        Returns:
            JSON string with write result.
        """
        try:
            data = self.client.remember_step(
                memory_id=self.memory_id,
                text=content,
                source=self.source,
                session_id=self._session_id,
                event_type=event_type,
                user_id=self.user_id,
            )
            return json.dumps(data, ensure_ascii=False, default=str)
        except Exception as exc:
            return f"Error writing to memory: {exc}"

    def memory_insights(
        self,
        query: Optional[str] = None,
        limit: int = 50,
    ) -> str:
        """Query knowledge cards, risks, and action items from memory.

        Args:
            query: Optional filter query.
            limit: Max items per category.

        Returns:
            JSON string with insights.
        """
        try:
            data = self.client.insights(
                memory_id=self.memory_id,
                query=query,
                limit=limit,
            )
            return json.dumps(data, ensure_ascii=False, default=str)
        except Exception as exc:
            return f"Error fetching insights: {exc}"

    def get_tool_functions(self) -> List[Dict[str, Any]]:
        """Return tool definitions as a list of dicts for manual registration."""
        return [
            {
                "name": "memory_search",
                "description": (
                    "Search Awareness Memory Cloud for relevant context. "
                    "Use this to recall past decisions, knowledge, and conversations."
                ),
                "callable": self.memory_search,
            },
            {
                "name": "memory_write",
                "description": (
                    "Write important information to Awareness Memory Cloud. "
                    "Use this to store decisions, insights, and findings for future recall."
                ),
                "callable": self.memory_write,
            },
            {
                "name": "memory_insights",
                "description": (
                    "Query structured insights (knowledge cards, risks, action items) "
                    "from Awareness Memory Cloud."
                ),
                "callable": self.memory_insights,
            },
        ]

    # ------------------------------------------------------------------
    # Message injection helpers (for frameworks with OpenAI-format messages)
    # ------------------------------------------------------------------

    def inject_into_messages(
        self,
        messages: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """Inject memory context into an OpenAI-format message list.

        Also stores the user message in background if auto_remember is enabled.
        """
        user_text = _extract_last_user_text(messages)
        if not user_text:
            return messages

        self._store_in_background(f"[user] {user_text}", actor="user")

        if self.query_rewrite != "none":
            memory_context = self._retrieve_context_from_messages(messages)
        else:
            memory_context = self._retrieve_context(user_text)
        if not memory_context:
            return messages

        messages = list(messages)
        if messages and messages[0].get("role") == "system":
            base_content = _strip_existing_memory_context(
                str(messages[0].get("content", ""))
            )
            messages[0] = {
                **messages[0],
                "content": memory_context + base_content,
            }
        else:
            messages.insert(0, {"role": "system", "content": memory_context})
        return messages

    def store_assistant_message(self, text: str) -> None:
        """Store an assistant response in background."""
        if text:
            self._store_in_background(f"[assistant] {text}", actor="assistant")

    # ------------------------------------------------------------------
    # Error handling
    # ------------------------------------------------------------------

    def _handle_error(self, message: str) -> None:
        if self.on_error == "raise":
            raise RuntimeError(message)
        elif self.on_error == "warn":
            logger.warning(message)


def _strip_existing_memory_context(content: str) -> str:
    """Remove old injected memory blocks to avoid prompt growth."""
    cleaned = _MEMORY_BLOCK_RE.sub("", content or "")
    return cleaned.lstrip()


def _normalize_insights_payload(payload: Any) -> Dict[str, Any]:
    """Normalize LLM extraction output to server submit_insights shape."""
    def _string_list(values: Any) -> List[str]:
        if not isinstance(values, list):
            return []
        out: List[str] = []
        for item in values:
            if isinstance(item, (str, int, float, bool)):
                val = str(item).strip()
                if val:
                    out.append(val)
                continue
            if isinstance(item, dict):
                for k in ("title", "name", "label", "value", "id"):
                    v = item.get(k)
                    if isinstance(v, (str, int, float, bool)):
                        val = str(v).strip()
                        if val:
                            out.append(val)
                        break
        return out

    def _normalize_card_list(values: Any) -> List[Dict[str, Any]]:
        if not isinstance(values, list):
            return []
        cards: List[Dict[str, Any]] = []
        for item in values:
            if not isinstance(item, dict):
                continue
            card = dict(item)
            if "tags" in card:
                card["tags"] = _string_list(card.get("tags"))
            if "methods" in card:
                card["methods"] = _string_list(card.get("methods"))
            if "evidence" in card:
                evidence_out: List[Dict[str, str]] = []
                raw_ev = card.get("evidence")
                if isinstance(raw_ev, list):
                    for ev in raw_ev:
                        if isinstance(ev, dict):
                            snippet = str(ev.get("snippet", "")).strip()
                            source = str(ev.get("source", "")).strip()
                            if snippet or source:
                                evidence_out.append({"snippet": snippet, "source": source})
                        elif isinstance(ev, str):
                            snippet = ev.strip()
                            if snippet:
                                evidence_out.append({"snippet": snippet, "source": ""})
                card["evidence"] = evidence_out
            cards.append(card)
        return cards

    def _normalize_dict_list(values: Any) -> List[Dict[str, Any]]:
        if not isinstance(values, list):
            return []
        return [dict(item) for item in values if isinstance(item, dict)]

    if isinstance(payload, dict) and isinstance(payload.get("insights"), dict):
        payload = payload["insights"]
    data = payload if isinstance(payload, dict) else {}
    normalized: Dict[str, Any] = {
        "knowledge_cards": _normalize_card_list(data.get("knowledge_cards", [])),
        "risks": _normalize_dict_list(data.get("risks", [])),
        "action_items": _normalize_dict_list(data.get("action_items", [])),
    }
    for optional_key in ("entities", "relations", "source_date", "source_texts"):
        if optional_key in data:
            normalized[optional_key] = data[optional_key]
    for list_key in ("knowledge_cards", "risks", "action_items", "entities", "relations"):
        if list_key in normalized and not isinstance(normalized[list_key], list):
            normalized[list_key] = []
    return normalized
