"""
Injected Conversation Demo (SDK-side, client-LLM extraction).

Goal:
1. Create a fresh memory under test user.
2. Use AwarenessInterceptor injection mode (send prompts only).
3. Let client LLM (Vercel AI Gateway) handle extraction and submit insights.
4. Verify structured outputs: insight / todo / risk.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

from memory_cloud import AwarenessInterceptor, MemoryCloudClient
from memory_cloud.integrations._base import _normalize_insights_payload
import requests

try:
    from openai import OpenAI
except Exception as exc:  # pragma: no cover - import guard for runtime
    raise RuntimeError("openai package is required. Install with: pip install openai") from exc


DEFAULT_USER_PROMPTS: List[str] = [
    "We decided to use Redis Streams for async event processing and keep PostgreSQL as source of truth.",
    "Please create an implementation plan to add idempotency keys on write endpoints this sprint.",
    "I am worried that webhook retries may cause duplicate downstream charges if signatures are not verified.",
    "Let's prioritize a rollback checklist and add an integration test for duplicate webhook delivery.",
]
DEFAULT_RECALL_PROMPT = (
    "Please continue yesterday's work. Summarize the key decision, remaining todos, "
    "active risks, and the single most important next action."
)


def _required_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    raise RuntimeError(f"Missing required env var, expected one of: {', '.join(names)}")


def _optional_env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return default


def build_memory_client() -> MemoryCloudClient:
    api_base = _optional_env(
        "AWARENESS_API_BASE_URL",
        "AWARENESS_BASE_URL",
        default="http://localhost:8000/api/v1",
    )
    api_key = _required_env("AWARENESS_API_KEY")
    return MemoryCloudClient(
        base_url=api_base,
        api_key=api_key,
        timeout=float(_optional_env("AWARENESS_TIMEOUT", default="60")),
        max_retries=int(_optional_env("AWARENESS_MAX_RETRIES", default="3")),
    )


def build_llm_client() -> OpenAI:
    gateway_base = _optional_env("AI_GATEWAY_URL", "OPENAI_API_BASE", default="https://ai-gateway.vercel.sh/v1")
    gateway_key = _required_env("AI_GATEWAY_API_KEY", "OPENAI_API_KEY")
    timeout_seconds = float(_optional_env("SDK_DEMO_LLM_TIMEOUT_SECONDS", default="45"))
    return OpenAI(
        api_key=gateway_key,
        base_url=gateway_base,
        timeout=timeout_seconds,
    )


def create_memory_for_test_user(client: MemoryCloudClient, owner_id: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    payload: Dict[str, Any] = {
        "name": f"SDK Injected Demo {now}",
        "description": (
            "Injection-mode SDK demo. Client LLM handles extraction and submits "
            "knowledge cards, risks, and action items."
        ),
        "custom_type": "universal",
        "owner_id": owner_id,
        "is_public": False,
        "config": {
            "default_source": "sdk-injected-demo",
            "metadata_defaults": {"agent_role": "sdk_demo"},
        },
    }
    created = client.create_memory(payload)
    memory_id = str(created.get("id") or "").strip()
    if not memory_id:
        raise RuntimeError(f"Create memory failed: {created}")
    return memory_id


def wait_for_backend_ready(base_url: str, timeout_seconds: int = 90) -> None:
    docs_url = base_url.replace("/api/v1", "/docs")
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            resp = requests.get(docs_url, timeout=5)
            if resp.status_code == 200:
                print(f"backend_ready={docs_url}")
                return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError(f"Backend not ready within {timeout_seconds}s: {docs_url}")


def create_memory_with_retry(client: MemoryCloudClient, owner_id: str, max_attempts: int = 5) -> str:
    delay = 1.5
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return create_memory_for_test_user(client, owner_id=owner_id)
        except Exception as exc:
            last_err = exc
            print(f"create_memory_retry attempt={attempt} err={exc}")
            time.sleep(delay)
            delay = min(delay * 2, 8)
    raise RuntimeError(f"create_memory failed after {max_attempts} attempts: {last_err}")


def load_user_prompts() -> List[str]:
    raw_json = os.getenv("SDK_DEMO_USER_PROMPTS_JSON", "").strip()
    if not raw_json:
        return DEFAULT_USER_PROMPTS
    try:
        parsed = json.loads(raw_json)
    except Exception as exc:
        raise RuntimeError("SDK_DEMO_USER_PROMPTS_JSON must be a JSON array of strings") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, str) and item.strip() for item in parsed):
        raise RuntimeError("SDK_DEMO_USER_PROMPTS_JSON must be a non-empty array of non-empty strings")
    return [item.strip() for item in parsed]


def _completion_with_retry(oai: OpenAI, model: str, messages: List[Dict[str, str]], max_attempts: int = 3) -> str:
    delay = 1.0
    last_error: Exception | None = None
    for _ in range(max_attempts):
        try:
            response = oai.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.3,
            )
            choices = getattr(response, "choices", None) or []
            if not choices:
                return ""
            content = choices[0].message.content or ""
            return str(content).strip()
        except Exception as exc:  # pragma: no cover - depends on runtime API
            last_error = exc
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"LLM completion failed after retries: {last_error}")


def _stream_completion_with_retry(
    oai: OpenAI,
    model: str,
    messages: List[Dict[str, str]],
    max_attempts: int = 3,
) -> str:
    delay = 1.0
    last_error: Exception | None = None
    for _ in range(max_attempts):
        try:
            stream = oai.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.3,
                stream=True,
            )
            chunks: List[str] = []
            print("[assistant stream] ", end="", flush=True)
            for event in stream:
                choices = getattr(event, "choices", None) or []
                if not choices:
                    continue
                delta = getattr(choices[0], "delta", None)
                piece = getattr(delta, "content", None) if delta is not None else None
                if piece:
                    text_piece = str(piece)
                    chunks.append(text_piece)
                    print(text_piece, end="", flush=True)
            print("", flush=True)
            return "".join(chunks).strip()
        except Exception as exc:  # pragma: no cover - depends on runtime API
            last_error = exc
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"LLM stream completion failed after retries: {last_error}")


def _coerce_json_object_text(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return raw
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
    if raw.startswith("{") and raw.endswith("}"):
        return raw
    match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
    return match.group(0).strip() if match else raw


def _parse_payload(text: str) -> Dict[str, Any]:
    normalized = _coerce_json_object_text(text)
    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        try:
            parsed = ast.literal_eval(normalized)
        except (ValueError, SyntaxError, TypeError) as lit_err:
            raise RuntimeError("invalid extraction payload: model did not return valid JSON") from lit_err
    if not isinstance(parsed, dict):
        raise RuntimeError("extraction payload is not an object")
    return parsed


def explicit_extract_and_submit(
    client: MemoryCloudClient,
    oai: OpenAI,
    model: str,
    memory_id: str,
    session_id: str,
    user_id: str,
    transcript: List[Dict[str, str]],
) -> None:
    valid_categories = {
        "problem_solution", "decision", "workflow", "key_point", "pitfall", "insight",
        "personal_preference", "important_detail", "plan_intention", "activity_preference",
        "health_info", "career_info", "custom_misc",
    }
    valid_status = {"open", "in_progress", "resolved", "noted", "superseded"}

    def _fallback_decision_card() -> Dict[str, Any] | None:
        for item in transcript:
            text = str(item.get("content", "")).strip()
            lowered = text.lower()
            if not text:
                continue
            if lowered.startswith("decision:") or " we decided " in f" {lowered} " or " decided to " in f" {lowered} ":
                title = text[:80].strip().rstrip(".")
                return {
                    "category": "decision",
                    "title": title or "Implementation Decision",
                    "summary": text[:400],
                    "tags": ["decision"],
                    "status": "noted",
                }
        return None

    system_prompt = (
        "You extract structured memory from conversation turns. "
        "Return one JSON object only with keys: knowledge_cards, risks, action_items. "
        "knowledge_cards must include at least one entry when decisions are present. "
        "Use concise summaries and concrete titles."
    )
    user_content = json.dumps(
        {
            "events": [f"[{item.get('role', 'unknown')}] {item.get('content', '')}" for item in transcript],
        },
        ensure_ascii=False,
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    try:
        response = oai.chat.completions.create(
            model=model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.1,
        )
    except Exception as exc:
        if "response_format" not in str(exc).lower():
            raise
        response = oai.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Return one valid JSON object only. "
                        "No markdown, no code fence, no extra text."
                    ),
                },
                *messages,
            ],
            temperature=0.1,
        )
    choices = getattr(response, "choices", None) or []
    if not choices:
        return
    raw_text = str(choices[0].message.content or "")
    try:
        parsed = _parse_payload(raw_text)
    except Exception as exc:
        print(f"explicit_extract_parse_failed={exc}")
        return
    normalized = _normalize_insights_payload(parsed)
    raw_cards = normalized.get("knowledge_cards") or []
    valid_cards: List[Dict[str, Any]] = []
    for card in raw_cards:
        if not isinstance(card, dict):
            continue
        title = str(card.get("title", "")).strip()
        summary = str(card.get("summary", "")).strip()
        if title and summary:
            cat = str(card.get("category", "decision")).strip().lower() or "decision"
            if cat not in valid_categories:
                cat = "decision"
            status = str(card.get("status", "noted")).strip().lower() or "noted"
            if status not in valid_status:
                status = "noted"
            conf_raw = card.get("confidence", 0.8)
            try:
                confidence = float(conf_raw)
            except Exception:
                confidence = 0.8
            confidence = max(0.0, min(1.0, confidence))
            tags_in = card.get("tags", [])
            tags = [str(t).strip() for t in tags_in if isinstance(t, (str, int, float, bool)) and str(t).strip()]
            valid_cards.append(
                {
                    "category": cat,
                    "title": title[:255],
                    "summary": summary[:1000],
                    "status": status,
                    "confidence": confidence,
                    "tags": tags,
                }
            )
    if not valid_cards:
        fallback_card = _fallback_decision_card()
        if fallback_card:
            valid_cards = [fallback_card]
    normalized["knowledge_cards"] = valid_cards
    print(
        "explicit_payload_summary="
        + json.dumps(
            {
                "knowledge_cards_count": len(normalized.get("knowledge_cards", [])),
                "risks_count": len(normalized.get("risks", [])),
                "action_items_count": len(normalized.get("action_items", [])),
                "first_card": (normalized.get("knowledge_cards") or [None])[0],
            },
            ensure_ascii=False,
        )
    )
    submit_result = client.submit_insights(
        memory_id=memory_id,
        insights=normalized,
        session_id=session_id,
        user_id=user_id,
        agent_role="sdk_demo",
    )
    print(f"explicit_submit_result={json.dumps(submit_result, ensure_ascii=False)}")


def run_prompt_only_session(
    client: MemoryCloudClient,
    oai: OpenAI,
    memory_id: str,
    owner_user_id: str,
    model: str,
    extraction_model: str,
    user_prompts: List[str],
    stream: bool = False,
) -> Dict[str, Any]:
    interceptor = AwarenessInterceptor(
        client=client,
        memory_id=memory_id,
        source="sdk-injected-demo",
        user_id=owner_user_id,
        agent_role="sdk_demo",
        enable_extraction=True,
        extraction_model=extraction_model,
    )
    interceptor.wrap_openai(oai)

    system_prompt = _optional_env(
        "SDK_DEMO_SYSTEM_PROMPT",
        default=(
            "You are an engineering assistant. Keep responses concise and operational. "
            "When user asks for plans, include explicit todos and risk mitigations."
        ),
    )

    transcript: List[Dict[str, str]] = []
    messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]

    for turn, user_prompt in enumerate(user_prompts, start=1):
        messages.append({"role": "user", "content": user_prompt})
        if stream:
            assistant_reply = _stream_completion_with_retry(oai=oai, model=model, messages=messages)
        else:
            assistant_reply = _completion_with_retry(oai=oai, model=model, messages=messages)
        messages.append({"role": "assistant", "content": assistant_reply})
        transcript.append({"role": "user", "content": user_prompt})
        transcript.append({"role": "assistant", "content": assistant_reply})
        print(f"[turn {turn}] user: {user_prompt}")
        if not stream:
            print(f"[turn {turn}] assistant: {assistant_reply[:240]}")
        else:
            print(f"[turn {turn}] assistant_len={len(assistant_reply)}")
        time.sleep(0.5)

    return {
        "session_id": interceptor.session_id,
        "transcript": transcript,
    }


def run_recall_session(
    client: MemoryCloudClient,
    oai: OpenAI,
    memory_id: str,
    owner_user_id: str,
    model: str,
    extraction_model: str,
    recall_prompt: str,
    stream: bool = False,
) -> Dict[str, Any]:
    interceptor = AwarenessInterceptor(
        client=client,
        memory_id=memory_id,
        source="sdk-injected-demo-recall",
        user_id=owner_user_id,
        agent_role="sdk_demo",
        enable_extraction=True,
        extraction_model=extraction_model,
    )
    interceptor.wrap_openai(oai)
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": "You are resuming a prior project session. Use recalled context."},
        {"role": "user", "content": recall_prompt},
    ]
    if stream:
        answer = _stream_completion_with_retry(oai=oai, model=model, messages=messages)
    else:
        answer = _completion_with_retry(oai=oai, model=model, messages=messages)
    return {
        "session_id": interceptor.session_id,
        "prompt": recall_prompt,
        "answer": answer,
    }


def wait_for_structured_outputs(
    client: MemoryCloudClient,
    memory_id: str,
    timeout_seconds: int = 45,
    poll_interval_seconds: float = 2.0,
) -> Dict[str, Any]:
    deadline = time.time() + timeout_seconds
    latest: Dict[str, Any] = {}
    while time.time() < deadline:
        latest = client.insights(memory_id=memory_id, limit=80)
        cards = latest.get("knowledge_cards") or []
        risks = latest.get("risks") or []
        actions = latest.get("action_items") or []
        if cards or risks or actions:
            return latest
        time.sleep(poll_interval_seconds)
    return latest


def summarize_insights(payload: Dict[str, Any]) -> Dict[str, Any]:
    cards = payload.get("knowledge_cards") or []
    risks = payload.get("risks") or []
    actions = payload.get("action_items") or []
    return {
        "knowledge_cards_count": len(cards),
        "risks_count": len(risks),
        "action_items_count": len(actions),
        "knowledge_cards_top": [c.get("title", "") for c in cards[:5]],
        "risks_top": [r.get("title", "") for r in risks[:5]],
        "action_items_top": [a.get("title", "") for a in actions[:5]],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="SDK injected conversation demo (prompt-only).")
    parser.add_argument("--owner-id", default=_optional_env("AWARENESS_OWNER_ID", default="test-user"))
    parser.add_argument("--user-id", default=_optional_env("SDK_DEMO_USER_ID", default="test-user"))
    parser.add_argument("--model", default=_optional_env("AI_GATEWAY_MODEL", "LLM_MODEL", default="meta/llama-3.1-8b"))
    parser.add_argument(
        "--extraction-model",
        default=_optional_env("AI_GATEWAY_EXTRACTION_MODEL", "AWARENESS_EXTRACTION_MODEL", default="openai/gpt-4o-mini"),
    )
    parser.add_argument("--wait-seconds", type=int, default=int(_optional_env("SDK_DEMO_WAIT_SECONDS", default="45")))
    parser.add_argument("--stream", action="store_true", help="Stream LLM tokens to stdout for live observability.")
    parser.add_argument("--backend-ready-timeout", type=int, default=int(_optional_env("SDK_DEMO_BACKEND_READY_TIMEOUT", default="90")))
    parser.add_argument(
        "--full-user-journey",
        action="store_true",
        help="Run two-phase journey: write/extract first, then start a new recall session.",
    )
    parser.add_argument(
        "--recall-prompt",
        default=_optional_env("SDK_DEMO_RECALL_PROMPT", default=DEFAULT_RECALL_PROMPT),
        help="Prompt used in recall phase when --full-user-journey is enabled.",
    )
    args = parser.parse_args()

    client = build_memory_client()
    wait_for_backend_ready(client.base_url, timeout_seconds=args.backend_ready_timeout)
    oai = build_llm_client()
    memory_id = create_memory_with_retry(client, owner_id=args.owner_id)
    print(f"memory_id={memory_id}")
    print(f"owner_id={args.owner_id}")
    print(f"user_id={args.user_id}")
    print(f"extraction_model={args.extraction_model}")

    prompts = load_user_prompts()
    session_data = run_prompt_only_session(
        client=client,
        oai=oai,
        memory_id=memory_id,
        owner_user_id=args.user_id,
        model=args.model,
        extraction_model=args.extraction_model,
        user_prompts=prompts,
        stream=args.stream,
    )
    print(f"session_id={session_data['session_id']}")

    insights_payload = wait_for_structured_outputs(
        client=client,
        memory_id=memory_id,
        timeout_seconds=args.wait_seconds,
    )
    summary = summarize_insights(insights_payload)
    enable_explicit_fallback = _optional_env("SDK_DEMO_ENABLE_EXPLICIT_EXTRACTION_FALLBACK", default="true").lower() in {"1", "true", "yes"}
    if enable_explicit_fallback and (
        summary["knowledge_cards_count"] == 0
        or summary["risks_count"] == 0
        or summary["action_items_count"] == 0
    ):
        print("explicit_extraction_fallback=running")
        explicit_extract_and_submit(
            client=client,
            oai=oai,
            model=args.model,
            memory_id=memory_id,
            session_id=session_data["session_id"],
            user_id=args.user_id,
            transcript=session_data["transcript"],
        )
        insights_payload = wait_for_structured_outputs(
            client=client,
            memory_id=memory_id,
            timeout_seconds=max(10, args.wait_seconds // 2),
            poll_interval_seconds=1.5,
        )
        summary = summarize_insights(insights_payload)

    recall_data: Dict[str, Any] = {}
    if args.full_user_journey:
        recall_query = (
            "webhook idempotency decision remaining todos active risks next action"
        )
        recall_raw = client.retrieve(
            memory_id=memory_id,
            query=recall_query,
            limit=5,
            recall_mode="hybrid",
            user_id=args.user_id,
            agent_role="sdk_demo",
        )
        recall_hits = recall_raw.get("results", []) if isinstance(recall_raw, dict) else []
        recall_data = run_recall_session(
            client=client,
            oai=oai,
            memory_id=memory_id,
            owner_user_id=args.user_id,
            model=args.model,
            extraction_model=args.extraction_model,
            recall_prompt=args.recall_prompt,
            stream=args.stream,
        )
        print(f"recall_session_id={recall_data.get('session_id')}")
        if not args.stream:
            print(f"recall_answer={str(recall_data.get('answer', ''))[:400]}")
        print(f"recall_retrieved_count={len(recall_hits)}")

    print(json.dumps(summary, ensure_ascii=False, indent=2))

    output = {
        "memory_id": memory_id,
        "owner_id": args.owner_id,
        "user_id": args.user_id,
        "session_id": session_data["session_id"],
        "model": args.model,
        "transcript": session_data["transcript"],
        "summary": summary,
        "recall": recall_data,
    }
    output_path = _optional_env("SDK_DEMO_OUTPUT_PATH", default="")
    if output_path:
        with open(output_path, "w", encoding="utf-8") as fp:
            json.dump(output, fp, ensure_ascii=False, indent=2)
        print(f"output_saved={output_path}")


if __name__ == "__main__":
    main()
