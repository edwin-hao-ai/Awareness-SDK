"""AwarenessInterceptor — transparent memory injection for OpenAI / Anthropic / custom LLM calls.

Usage:
    from memory_cloud import MemoryCloudClient, AwarenessInterceptor

    client = MemoryCloudClient(base_url="...", api_key="...")
    interceptor = AwarenessInterceptor(client=client, memory_id="mem-xxx")

    # OpenAI
    import openai
    oai = openai.OpenAI()
    interceptor.wrap_openai(oai)
    # Now oai.chat.completions.create() automatically injects/stores memory

    # Anthropic
    import anthropic
    ant = anthropic.Anthropic()
    interceptor.wrap_anthropic(ant)
    # Now ant.messages.create() automatically injects/stores memory

    # Custom function (e.g. LiteLLM)
    from litellm import completion
    wrapped = interceptor.register_function(completion)
    # Now wrapped(messages=[...]) injects/stores memory
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


def _extract_last_user_message_openai(messages: List[Dict[str, Any]]) -> str:
    """Extract last user message from OpenAI-format messages."""
    for msg in reversed(messages):
        if isinstance(msg, dict) and msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, str):
                return content
            # Handle content parts (vision API)
            if isinstance(content, list):
                texts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
                return " ".join(texts)
    return ""


def _extract_assistant_text_openai(response: Any) -> str:
    """Extract assistant text from OpenAI ChatCompletion response."""
    try:
        choices = getattr(response, "choices", None) or []
        if choices:
            msg = getattr(choices[0], "message", None)
            if msg:
                return getattr(msg, "content", "") or ""
    except Exception:
        pass
    return ""


def _extract_last_user_message_anthropic(messages: List[Dict[str, Any]]) -> str:
    """Extract last user message from Anthropic-format messages."""
    for msg in reversed(messages):
        if isinstance(msg, dict) and msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                texts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
                return " ".join(texts)
    return ""


def _extract_assistant_text_anthropic(response: Any) -> str:
    """Extract assistant text from Anthropic Message response."""
    try:
        content_blocks = getattr(response, "content", None) or []
        texts = []
        for block in content_blocks:
            if getattr(block, "type", "") == "text":
                texts.append(getattr(block, "text", ""))
        return " ".join(texts)
    except Exception:
        pass
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


class AwarenessInterceptor:
    """Transparent memory interceptor for LLM API calls.

    PRE-call:
      1. Extract last user message from messages
      2. client.retrieve(query=user_msg) to search relevant memories
      3. Inject memory context into system prompt

    POST-call (background, non-blocking):
      1. Store user message via client.record()
      2. Store assistant response via client.record()
      3. If extraction_request is returned, use original LLM to extract insights
      4. Submit extracted insights via client._submit_insights()
    """

    def __init__(
        self,
        client: MemoryCloudClient,
        memory_id: str,
        *,
        source: str = "interceptor",
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
        query_rewrite: str = "rule",  # "none" | "rule" | "llm"
        on_error: str = "warn",  # "warn" | "raise" | "ignore"
    ):
        self.client = client
        self.memory_id = memory_id
        self.source = source
        self.user_id = user_id
        self.agent_role = agent_role
        self.retrieve_limit = retrieve_limit
        self.max_context_chars = max_context_chars
        self.min_relevance_score = min_relevance_score
        self.max_inject_items = max_inject_items
        self.auto_remember = auto_remember
        self.enable_extraction = enable_extraction
        self.extraction_model = extraction_model
        self.extraction_max_tokens = (
            extraction_max_tokens
            or int(os.getenv("AWARENESS_EXTRACTION_MAX_TOKENS", "0"))
            or _DEFAULT_EXTRACTION_MAX_TOKENS
        )
        self.query_rewrite = query_rewrite
        self.on_error = on_error

        # Captured original LLM create functions for extraction
        self._original_openai_create: Optional[Callable] = None
        self._original_anthropic_create: Optional[Callable] = None
        self._original_fn: Optional[Callable] = None

        # Agent profile system prompt (injected before memory context)
        self._agent_system_prompt: str = ""
        if agent_role:
            try:
                prompt = client.get_agent_prompt(memory_id, agent_role)
                if prompt:
                    self._agent_system_prompt = prompt
                    logger.info("Agent prompt loaded for role '%s' (%d chars)", agent_role, len(prompt))
            except Exception as exc:
                logger.debug("Agent prompt fetch skipped for '%s': %s", agent_role, exc)

        # Begin session
        if session_id:
            self._session_id = session_id
        else:
            result = client._begin_memory_session(
                memory_id=memory_id,
                source=source,
            )
            self._session_id = result["session_id"]

    @property
    def session_id(self) -> str:
        return self._session_id

    # ------------------------------------------------------------------
    # Memory retrieval
    # ------------------------------------------------------------------

    def _retrieve_context_from_messages(self, messages: List[Dict[str, Any]]) -> str:
        """Retrieve relevant memories using context-aware query rewriting.

        Applies progressive query rewrite layers:
          - rule: Layer 1 (context-aware) + Layer 2 (structural keywords)
          - llm: Layer 3 (LLM rewrite using the wrapped LLM)
          - none: just use last user message as-is
        """
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
        original = self._original_openai_create or self._original_anthropic_create
        if not original:
            return None

        model = self.extraction_model or "gpt-4o-mini"

        if self._original_openai_create is not None:
            fn = self._original_openai_create

            def _call_openai(system_prompt: str, user_content: str) -> str:
                resp = fn(
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

        if self._original_anthropic_create is not None:
            fn = self._original_anthropic_create

            def _call_anthropic(system_prompt: str, user_content: str) -> str:
                resp = fn(
                    model=model,
                    system=system_prompt,
                    messages=[{"role": "user", "content": user_content}],
                    max_tokens=120,
                )
                return resp.content[0].text if resp.content else ""

            return _call_anthropic

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

            parts = []
            total_chars = 0
            for item in items:
                content = str(item.get("content", ""))
                if total_chars + len(content) > self.max_context_chars:
                    break
                parts.append(content)
                total_chars += len(content)

            if not parts:
                prefix = f"{self._agent_system_prompt}\n\n" if self._agent_system_prompt else ""
                return prefix
            memory_block = "[Relevant memories]\n" + "\n---\n".join(parts) + "\n[End memories]\n\n"
            if self._agent_system_prompt:
                return f"{self._agent_system_prompt}\n\n{memory_block}"
            return memory_block
        except Exception as e:
            self._handle_error(f"Memory retrieval failed: {e}")
            return ""

    def _build_metadata_filter(self) -> Optional[Dict[str, Any]]:
        """Build metadata filter for user_id + agent_role."""
        f: Dict[str, Any] = {}
        if self.user_id:
            f["user_id"] = self.user_id
        if self.agent_role:
            f["agent_role"] = self.agent_role
        return f if f else None

    # ------------------------------------------------------------------
    # Background storage + extraction
    # ------------------------------------------------------------------

    def _store_in_background(self, user_text: str, assistant_text: str) -> None:
        """Store user + assistant messages as events in a background thread.

        If the server returns an extraction_request, process it using the
        original LLM function (async, non-blocking).
        """
        if not self.auto_remember:
            return

        def _store():
            extraction_req = None
            try:
                if user_text.strip():
                    result = self.client.record(
                        self.memory_id,
                        content=f"[user] {user_text}",
                        scope="timeline",
                        session_id=self._session_id,
                        source=self.source,
                        user_id=self.user_id or "",
                        agent_role=self.agent_role or "",
                        generate_summary=False,
                    )
                    ingest = result.get("ingest") or {}
                    if isinstance(ingest, dict) and "extraction_request" in ingest:
                        extraction_req = ingest["extraction_request"]

                if assistant_text.strip():
                    result = self.client.record(
                        self.memory_id,
                        content=f"[assistant] {assistant_text}",
                        scope="timeline",
                        session_id=self._session_id,
                        source=self.source,
                        user_id=self.user_id or "",
                        agent_role=self.agent_role or "",
                        generate_summary=False,
                    )
                    ingest = result.get("ingest") or {}
                    if isinstance(ingest, dict) and "extraction_request" in ingest:
                        extraction_req = ingest["extraction_request"]
            except Exception as e:
                logger.warning(f"Background memory storage failed: {e}")

            # Run extraction if we got a request
            if extraction_req and self.enable_extraction:
                self._run_extraction(extraction_req)

        thread = threading.Thread(target=_store, daemon=True)
        thread.start()

    def _run_extraction(self, extraction_request: Dict[str, Any]) -> None:
        """Call the original LLM function to extract insights, then submit them.

        Uses the user's own LLM — only 1 LLM call, non-blocking.
        """
        try:
            system_prompt = extraction_request.get("system_prompt", "")
            events = extraction_request.get("events", [])
            existing_cards = extraction_request.get("existing_cards", [])

            # Replace {existing_cards} placeholder in prompt
            cards_json = json.dumps(existing_cards, indent=2, ensure_ascii=False) if existing_cards else "[]"
            filled_prompt = system_prompt.replace("{existing_cards}", cards_json)

            compact_events = _compact_events_for_extraction(events)
            user_content = json.dumps({
                "events": compact_events,
            }, ensure_ascii=False)

            text = self._call_llm_for_extraction(filled_prompt, user_content)
            if not text:
                return

            # Parse JSON from LLM response (with markdown/extra-text tolerance).
            # Retry once with stricter instruction when the model returns malformed JSON.
            try:
                insights = _parse_insights_payload(text)
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
                retry_text = self._call_llm_for_extraction(retry_prompt, retry_content)
                if not retry_text:
                    return
                insights = _parse_insights_payload(retry_text)
            # Extract turn_brief before normalization (not part of insights schema)
            turn_brief = insights.pop("turn_brief", None)

            from memory_cloud.integrations._base import _normalize_insights_payload
            insights = _normalize_insights_payload(insights)

            # Submit to server (server-side dedup)
            self.client._submit_insights(
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
                    self.client.record(
                        self.memory_id,
                        content=turn_brief.strip(),
                        scope="timeline",
                        session_id=extraction_request.get("session_id", self._session_id),
                        source=self.source,
                        user_id=self.user_id or "",
                        generate_summary=False,
                    )
                    logger.info("Turn brief stored: %s", turn_brief[:80])
                except Exception as tb_exc:
                    logger.warning(f"Turn brief storage failed: {tb_exc}")
        except json.JSONDecodeError as e:
            logger.warning(f"Extraction LLM returned invalid JSON: {e}")
        except Exception as e:
            logger.warning(f"Background extraction failed: {e}", exc_info=True)

    def _call_llm_for_extraction(self, system_prompt: str, user_content: str) -> str:
        """Call the original LLM function for extraction. Returns raw text response."""
        if self._original_openai_create:
            model = self.extraction_model or "gpt-4o-mini"
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ]
            try:
                response = self._original_openai_create(
                    model=model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0,
                    max_tokens=self.extraction_max_tokens,
                )
            except Exception as exc:
                # Some OpenAI-compatible gateways/models do not support response_format.
                if "response_format" not in str(exc).lower():
                    raise
                response = self._original_openai_create(
                    model=model,
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
            return _extract_assistant_text_openai(response)

        if self._original_anthropic_create:
            model = self.extraction_model or "claude-haiku-4-5-20251001"
            response = self._original_anthropic_create(
                model=model,
                system=system_prompt,
                messages=[{"role": "user", "content": user_content}],
                max_tokens=self.extraction_max_tokens,
            )
            return _extract_assistant_text_anthropic(response)

        if self._original_fn:
            response = self._original_fn(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
            )
            return _extract_assistant_text_openai(response)

        logger.warning("No original LLM function available for extraction")
        return ""

    # ------------------------------------------------------------------
    # OpenAI wrapping
    # ------------------------------------------------------------------

    def wrap_openai(self, openai_client: Any) -> None:
        """Monkey-patch openai_client.chat.completions.create to inject memory.

        Supports both sync and async OpenAI clients.
        """
        completions = openai_client.chat.completions
        original_create = completions.create
        self._original_openai_create = original_create
        interceptor = self

        def patched_create(*args: Any, **kwargs: Any) -> Any:
            messages = list(kwargs.get("messages", []))

            # PRE-call: inject memory context (with query rewriting)
            user_text = _extract_last_user_message_openai(messages)
            if interceptor.query_rewrite != "none":
                memory_context = interceptor._retrieve_context_from_messages(messages)
            else:
                memory_context = interceptor._retrieve_context(user_text)

            if memory_context:
                if messages and messages[0].get("role") == "system":
                    messages[0] = {
                        **messages[0],
                        "content": memory_context + str(messages[0].get("content", "")),
                    }
                else:
                    messages.insert(0, {"role": "system", "content": memory_context})
                kwargs["messages"] = messages

            # Call original
            response = original_create(*args, **kwargs)

            # POST-call: store in background
            assistant_text = _extract_assistant_text_openai(response)
            interceptor._store_in_background(user_text, assistant_text)

            return response

        completions.create = patched_create

    # ------------------------------------------------------------------
    # Anthropic wrapping
    # ------------------------------------------------------------------

    def wrap_anthropic(self, anthropic_client: Any) -> None:
        """Monkey-patch anthropic_client.messages.create to inject memory.

        Supports both sync and async Anthropic clients.
        """
        messages_api = anthropic_client.messages
        original_create = messages_api.create
        self._original_anthropic_create = original_create
        interceptor = self

        def patched_create(*args: Any, **kwargs: Any) -> Any:
            messages = list(kwargs.get("messages", []))

            # PRE-call: inject memory context (with query rewriting)
            user_text = _extract_last_user_message_anthropic(messages)
            if interceptor.query_rewrite != "none":
                memory_context = interceptor._retrieve_context_from_messages(messages)
            else:
                memory_context = interceptor._retrieve_context(user_text)

            if memory_context:
                system = kwargs.get("system", "")
                if isinstance(system, str):
                    kwargs["system"] = memory_context + system
                elif isinstance(system, list):
                    # System can be a list of content blocks
                    kwargs["system"] = [{"type": "text", "text": memory_context}] + list(system)
                else:
                    kwargs["system"] = memory_context

            # Call original
            response = original_create(*args, **kwargs)

            # POST-call: store in background
            assistant_text = _extract_assistant_text_anthropic(response)
            interceptor._store_in_background(user_text, assistant_text)

            return response

        messages_api.create = patched_create

    # ------------------------------------------------------------------
    # Generic function wrapping (LiteLLM, etc.)
    # ------------------------------------------------------------------

    def register_function(self, fn: Callable) -> Callable:
        """Wrap any function that accepts messages=[...] kwargs (e.g. LiteLLM completion).

        The wrapped function injects memory into messages pre-call and stores
        the conversation post-call.
        """
        self._original_fn = fn
        interceptor = self

        def wrapped(*args: Any, **kwargs: Any) -> Any:
            messages = list(kwargs.get("messages", []))

            # PRE-call: inject memory context (with query rewriting)
            user_text = _extract_last_user_message_openai(messages)
            if interceptor.query_rewrite != "none":
                memory_context = interceptor._retrieve_context_from_messages(messages)
            else:
                memory_context = interceptor._retrieve_context(user_text)

            if memory_context:
                if messages and messages[0].get("role") == "system":
                    messages[0] = {
                        **messages[0],
                        "content": memory_context + str(messages[0].get("content", "")),
                    }
                else:
                    messages.insert(0, {"role": "system", "content": memory_context})
                kwargs["messages"] = messages

            response = fn(*args, **kwargs)

            # POST-call: store in background
            assistant_text = _extract_assistant_text_openai(response)
            interceptor._store_in_background(user_text, assistant_text)

            return response

        return wrapped

    # ------------------------------------------------------------------
    # Error handling
    # ------------------------------------------------------------------

    def _handle_error(self, message: str) -> None:
        if self.on_error == "raise":
            raise RuntimeError(message)
        elif self.on_error == "warn":
            logger.warning(message)
        # "ignore" — do nothing
