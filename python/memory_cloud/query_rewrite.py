"""Query rewriting utilities for improving memory retrieval quality.

Three-layer progressive strategy:
  Layer 1: Context-aware query — combine recent conversation turns for richer semantic search
  Layer 2: Structural keyword extraction — language-agnostic token extraction for BM25
  Layer 3: LLM query rewrite — optional, uses the user's LLM for optimal rewriting
"""

import json
import logging
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Max conversation turns to include in context-aware query
_DEFAULT_CONTEXT_TURNS = 3
_DEFAULT_MAX_CONTEXT_QUERY_CHARS = 800
_DEFAULT_MAX_KEYWORDS = 10

# LLM rewrite system prompt — kept minimal for speed (~30 token output)
_REWRITE_SYSTEM_PROMPT = (
    "You are a query optimizer for a memory retrieval system. "
    "Given conversation context, rewrite the user's latest message into an optimal search query.\n\n"
    "Output JSON only: {\"semantic_query\": \"<natural language question for vector search>\", "
    "\"keyword_query\": \"<2-8 precise terms for full-text search, space-separated>\"}\n\n"
    "Rules:\n"
    "- semantic_query: Expand ambiguous references using conversation context. "
    "If user says 'continue', explain WHAT to continue based on context.\n"
    "- keyword_query: Extract proper nouns, file names, technical terms, project names, "
    "people names, product names, error codes. Omit common words.\n"
    "- Write in the SAME LANGUAGE as the user's message.\n"
    "- Output ONLY the JSON object, nothing else."
)


def build_context_query(
    messages: List[Dict[str, Any]],
    *,
    max_turns: int = _DEFAULT_CONTEXT_TURNS,
    max_chars: int = _DEFAULT_MAX_CONTEXT_QUERY_CHARS,
) -> str:
    """Layer 1: Build a richer query from recent conversation turns.

    Instead of using only the last user message, combine recent turns
    so the vector search has contextual understanding.

    Args:
        messages: OpenAI/Anthropic format message list.
        max_turns: Max recent turns to include (default 3).
        max_chars: Max total characters for the query string.

    Returns:
        A context-enriched query string for vector search.
    """
    if not messages:
        return ""

    # Collect recent turns (user + assistant), reversed
    recent: List[str] = []
    total_chars = 0
    turns_seen = 0

    for msg in reversed(messages):
        if turns_seen >= max_turns:
            break
        role = msg.get("role", "")
        if role not in ("user", "assistant"):
            continue

        content = _extract_text_content(msg)
        if not content.strip():
            continue

        # Truncate individual messages
        if len(content) > max_chars // max_turns:
            content = content[: max_chars // max_turns]

        recent.append(f"[{role}] {content}")
        total_chars += len(content)
        turns_seen += 1

        if total_chars >= max_chars:
            break

    if not recent:
        return ""

    # Most recent first → reverse to chronological
    recent.reverse()
    return "\n".join(recent)


def extract_keywords(
    text: str,
    *,
    max_keywords: int = _DEFAULT_MAX_KEYWORDS,
) -> str:
    """Layer 2: Language-agnostic structural keyword extraction for BM25.

    Extracts tokens that carry high information density regardless of language.
    No stopword lists, no language-specific NLP needed.

    Args:
        text: Input text (can be multi-turn context or single message).
        max_keywords: Max keywords to return.

    Returns:
        Space-separated keyword string for BM25. Empty string if nothing extracted.
    """
    if not text:
        return ""

    tokens: List[str] = []

    # 1. Quoted content — user explicitly marked as important (any language)
    #    "seasonal budget", "JWT token", etc.
    tokens += re.findall(r'["\u201c]([^"\u201d]{2,40})["\u201d]', text)
    tokens += re.findall(r"'([^']{2,40})'", text)

    # 2. File/path patterns — universal across programming & office work
    #    auth.py, config.yaml, report.xlsx, src/utils, /api/v1
    tokens += re.findall(r'[\w.-]+\.(?:py|js|ts|tsx|jsx|yml|yaml|json|md|csv|xlsx|pdf|sql|go|rs|java|rb|sh|env|toml|cfg|conf|xml|html|css|txt|log|zip|tar|gz|doc|docx|ppt|pptx)\b', text, re.IGNORECASE)
    tokens += re.findall(r'(?:^|[\s(])(/[\w./-]+)', text)

    # 3. UPPER-case tokens — acronyms, codes, constants (JWT, SOC2, API, ERR_001)
    tokens += re.findall(r'\b[A-Z][A-Z0-9_]{1,15}\b', text)

    # 4. Mixed-case identifiers — camelCase, PascalCase
    tokens += re.findall(r'\b[a-z]+(?:[A-Z][a-z0-9]+)+\b', text)

    # 5. Snake/kebab identifiers — user_auth, api-gateway
    tokens += re.findall(r'\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b', text)

    # 6. Numbers with context — versions, IDs, status codes, dates
    #    v2.1, #1234, 2024-03-07, 404, P2002
    tokens += re.findall(r'[#vV]?\d[\d.,:-]+(?:\w+)?', text)
    tokens += re.findall(r'\b[A-Z]+\d+\b', text)  # P2002, ERR001

    # 7. CJK sequences near title/role suffixes — proper nouns
    #    张总, 王经理, 李老师, 刘部长
    tokens += re.findall(
        r'([\u4e00-\u9fff]{1,4})(?=总|经理|老师|部长|主任|先生|女士|同学|医生|律师|教授|博士|组长|队长|院长|处长|科长|厅长|局长|市长|省长|董事)',
        text,
    )
    # Full name+title as one token
    tokens += re.findall(
        r'[\u4e00-\u9fff]{1,4}(?:总|经理|老师|部长|主任|先生|女士|同学|医生|律师|教授|博士)',
        text,
    )

    # 8. @ mentions and # hashtags
    tokens += re.findall(r'[@#][\w\u4e00-\u9fff]+', text)

    # Dedupe, preserve order, limit count
    seen: set = set()
    result: List[str] = []
    for t in tokens:
        t = t.strip()
        if not t or len(t) < 2:
            continue
        key = t.lower()
        if key not in seen:
            seen.add(key)
            result.append(t)
        if len(result) >= max_keywords:
            break

    return " ".join(result)


def rewrite_query_with_llm(
    messages: List[Dict[str, Any]],
    llm_fn: Callable[..., str],
    *,
    max_context_turns: int = 4,
    max_input_chars: int = 1200,
) -> Tuple[str, str]:
    """Layer 3: Use the user's LLM to rewrite query for optimal retrieval.

    Args:
        messages: Conversation history (OpenAI format).
        llm_fn: Callable that takes (system_prompt: str, user_content: str) -> str.
                 Should return raw text (we parse JSON from it).
        max_context_turns: Max turns to include in context.
        max_input_chars: Max chars for the context sent to LLM.

    Returns:
        (semantic_query, keyword_query) tuple.
        Falls back to (last_user_msg, "") on any failure.
    """
    last_user = _extract_last_user_message(messages)
    if not last_user.strip():
        return ("", "")

    # Build compact context for the LLM
    context_lines: List[str] = []
    total = 0
    turns = 0
    for msg in reversed(messages):
        if turns >= max_context_turns:
            break
        role = msg.get("role", "")
        if role not in ("user", "assistant"):
            continue
        content = _extract_text_content(msg)
        if not content.strip():
            continue
        truncated = content[:300] if len(content) > 300 else content
        context_lines.append(f"[{role}]: {truncated}")
        total += len(truncated)
        turns += 1
        if total >= max_input_chars:
            break

    context_lines.reverse()
    user_content = "Conversation context:\n" + "\n".join(context_lines)

    try:
        raw = llm_fn(_REWRITE_SYSTEM_PROMPT, user_content)
        if not raw:
            return (last_user, extract_keywords(last_user))

        # Parse JSON from response
        parsed = _parse_json_response(raw)
        semantic = parsed.get("semantic_query", "").strip()
        keywords = parsed.get("keyword_query", "").strip()

        # Sanity: if LLM returned empty semantic, fall back
        if not semantic:
            semantic = last_user

        return (semantic, keywords)
    except Exception as e:
        logger.debug(f"LLM query rewrite failed, using fallback: {e}")
        return (last_user, extract_keywords(last_user))


def build_retrieve_queries(
    messages: List[Dict[str, Any]],
    *,
    llm_fn: Optional[Callable[..., str]] = None,
    use_llm_rewrite: bool = False,
    max_context_turns: int = _DEFAULT_CONTEXT_TURNS,
) -> Tuple[str, str]:
    """Main entry point: build (semantic_query, keyword_query) for retrieval.

    Applies layers progressively:
      - Always: Layer 1 (context-aware query) + Layer 2 (structural keywords)
      - If use_llm_rewrite=True and llm_fn provided: Layer 3 (LLM rewrite) instead

    Args:
        messages: Conversation history.
        llm_fn: Optional LLM callable for Layer 3.
        use_llm_rewrite: Whether to use LLM rewriting.
        max_context_turns: Max turns for context building.

    Returns:
        (semantic_query, keyword_query) tuple ready for retrieve().
    """
    if not messages:
        return ("", "")

    last_user = _extract_last_user_message(messages)

    # Layer 3: LLM rewrite (replaces Layer 1+2 when enabled)
    if use_llm_rewrite and llm_fn is not None:
        semantic, keywords = rewrite_query_with_llm(
            messages, llm_fn, max_context_turns=max_context_turns
        )
        # If LLM didn't produce keywords, still try structural extraction
        if not keywords:
            context = build_context_query(messages, max_turns=max_context_turns)
            keywords = extract_keywords(context or last_user)
        return (semantic, keywords)

    # Layer 1: Context-aware query for vector search
    context_query = build_context_query(messages, max_turns=max_context_turns)
    semantic = context_query if context_query else last_user

    # Layer 2: Structural keyword extraction for BM25
    # Extract from full context (richer) not just last message
    source_text = context_query if context_query else last_user
    keywords = extract_keywords(source_text)

    return (semantic, keywords)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_text_content(msg: Dict[str, Any]) -> str:
    """Extract text from a message (handles string and content-parts formats)."""
    content = msg.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    texts.append(part.get("text", ""))
        return " ".join(texts)
    return str(content)


def _extract_last_user_message(messages: List[Dict[str, Any]]) -> str:
    """Extract the last user message from the conversation."""
    for msg in reversed(messages):
        if isinstance(msg, dict) and msg.get("role") == "user":
            return _extract_text_content(msg)
    return ""


def _parse_json_response(text: str) -> Dict[str, Any]:
    """Parse JSON from LLM response, handling markdown fences."""
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw).strip()
    if raw.startswith("{"):
        return json.loads(raw)
    match = re.search(r"\{[^}]+\}", raw, flags=re.DOTALL)
    if match:
        return json.loads(match.group(0))
    raise ValueError(f"No JSON found in LLM response: {raw[:200]}")
