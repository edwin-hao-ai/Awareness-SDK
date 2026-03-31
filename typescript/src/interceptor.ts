/**
 * AwarenessInterceptor — transparent memory injection for OpenAI / Anthropic / custom LLM calls.
 *
 * Usage:
 *   import { MemoryCloudClient } from "awareness-memory-cloud";
 *   import { AwarenessInterceptor } from "awareness-memory-cloud";
 *   import OpenAI from "openai";
 *
 *   const client = new MemoryCloudClient({ baseUrl: "...", apiKey: "..." });
 *   const interceptor = await AwarenessInterceptor.create({ client, memoryId: "mem-xxx" });
 *
 *   const oai = new OpenAI();
 *   interceptor.wrapOpenAI(oai);
 *   // oai.chat.completions.create() now automatically injects/stores memory
 */

import { MemoryCloudClient } from "./client";
import { readPositiveIntEnv } from "./env";
import { JsonObject } from "./types";

const DEFAULT_EXTRACTION_MAX_TOKENS = 16384;

export interface AwarenessInterceptorConfig {
  client: MemoryCloudClient;
  memoryId: string;
  source?: string;
  sessionId?: string;
  userId?: string;
  agentRole?: string;
  retrieveLimit?: number;
  maxContextChars?: number;
  minRelevanceScore?: number;
  maxInjectItems?: number;
  autoRemember?: boolean;
  enableExtraction?: boolean;
  extractionModel?: string;
  /** Max tokens for extraction LLM calls. Default: 16384. Env: AWARENESS_EXTRACTION_MAX_TOKENS */
  extractionMaxTokens?: number;
  queryRewrite?: "none" | "rule" | "llm";
  onError?: "warn" | "raise" | "ignore";
}

interface Message {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
}

interface ExtractionRequest {
  memory_id: string;
  session_id: string;
  events: Array<{ content: string; event_type?: string; source?: string }>;
  existing_cards: Array<{ id: string; title: string; summary: string; category: string }>;
  system_prompt: string;
}

function extractLastUserMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "user") {
      const content = msg.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .filter((p) => p?.type === "text")
          .map((p) => p?.text ?? "")
          .join(" ");
      }
    }
  }
  return "";
}

function extractAssistantTextOpenAI(response: any): string {
  try {
    const choices = response?.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      return choices[0]?.message?.content ?? "";
    }
  } catch {
    // ignore
  }
  return "";
}

function extractAssistantTextAnthropic(response: any): string {
  try {
    const blocks = response?.content;
    if (Array.isArray(blocks)) {
      return blocks
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b?.text ?? "")
        .join(" ");
    }
  } catch {
    // ignore
  }
  return "";
}

function coerceJsonObjectText(text: string): string {
  const raw0 = String(text ?? "").trim();
  if (!raw0) return raw0;
  let raw = raw0;
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  if (raw.startsWith("{") && raw.endsWith("}")) return raw;
  // Brace-depth matching: find the first top-level { ... } block
  const start = raw.indexOf("{");
  if (start === -1) return raw;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; }
    else if (!inStr) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
  }
  // Fallback: return from first brace to end (incomplete JSON, let parser handle)
  return raw.slice(start);
}

function parseInsightsPayload(text: string): JsonObject {
  const normalized = coerceJsonObjectText(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch (err) {
    throw new Error("Invalid extraction payload: model did not return a valid JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid extraction payload: expected top-level object");
  }
  return parsed as JsonObject;
}

function compactEventsForExtraction(
  events: Array<{ content: string; event_type?: string; source?: string }>,
  options?: {
    maxEvents?: number;
    maxCharsPerEvent?: number;
    maxTotalChars?: number;
  }
): string[] {
  const maxEvents = options?.maxEvents ?? 20;
  const maxCharsPerEvent = options?.maxCharsPerEvent ?? 0;
  const maxTotalChars = options?.maxTotalChars ?? 0;
  const compacted: string[] = [];
  let total = 0;

  for (const event of events.slice(0, maxEvents)) {
    const raw = String(event?.content ?? "").trim();
    if (!raw) continue;
    const clipped = maxCharsPerEvent > 0 ? raw.slice(0, maxCharsPerEvent) : raw;
    if (maxTotalChars > 0 && total + clipped.length > maxTotalChars) break;
    compacted.push(clipped);
    total += clipped.length;
  }
  return compacted;
}

// ---------------------------------------------------------------------------
// Query rewrite helpers (Layer 1 + Layer 2)
// ---------------------------------------------------------------------------

const REWRITE_SYSTEM_PROMPT =
  "You are a query optimizer for a memory retrieval system. " +
  "Given conversation context, rewrite the user's latest message into an optimal search query.\n\n" +
  'Output JSON only: {"semantic_query": "<natural language question for vector search>", ' +
  '"keyword_query": "<2-8 precise terms for full-text search, space-separated>"}\n\n' +
  "Rules:\n" +
  "- semantic_query: Expand ambiguous references using conversation context. " +
  "If user says 'continue', explain WHAT to continue based on context.\n" +
  "- keyword_query: Extract proper nouns, file names, technical terms, project names, " +
  "people names, product names, error codes. Omit common words.\n" +
  "- Write in the SAME LANGUAGE as the user's message.\n" +
  "- Output ONLY the JSON object, nothing else.";

function extractTextContent(msg: Message): string {
  const content = msg?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text")
      .map((p) => p?.text ?? "")
      .join(" ");
  }
  return String(content ?? "");
}

function buildContextQuery(
  messages: Message[],
  maxTurns: number = 3,
  maxChars: number = 800,
): string {
  if (!messages || messages.length === 0) return "";
  const recent: string[] = [];
  let totalChars = 0;
  let turns = 0;
  for (let i = messages.length - 1; i >= 0 && turns < maxTurns; i--) {
    const msg = messages[i];
    const role = msg?.role;
    if (role !== "user" && role !== "assistant") continue;
    let content = extractTextContent(msg);
    if (!content.trim()) continue;
    const perTurn = Math.floor(maxChars / maxTurns);
    if (content.length > perTurn) content = content.slice(0, perTurn);
    recent.push(`[${role}] ${content}`);
    totalChars += content.length;
    turns++;
    if (totalChars >= maxChars) break;
  }
  recent.reverse();
  return recent.join("\n");
}

function extractKeywords(text: string, maxKeywords: number = 10): string {
  if (!text) return "";
  const tokens: string[] = [];

  // 1. Quoted content (any language)
  for (const m of text.matchAll(/["\u201c]([^"\u201d]{2,40})["\u201d]/g)) tokens.push(m[1]);
  for (const m of text.matchAll(/'([^']{2,40})'/g)) tokens.push(m[1]);

  // 2. File patterns
  for (const m of text.matchAll(
    /[\w.-]+\.(?:py|js|ts|tsx|jsx|yml|yaml|json|md|csv|xlsx|pdf|sql|go|rs|java|rb|sh|env|toml|cfg|conf|xml|html|css|txt|log|zip|tar|gz|doc|docx|ppt|pptx)\b/gi,
  ))
    tokens.push(m[0]);

  // 3. UPPER-case tokens (acronyms, codes)
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9_]{1,15}\b/g)) tokens.push(m[0]);

  // 4. camelCase/PascalCase
  for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) tokens.push(m[0]);

  // 5. snake_case/kebab-case
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/g)) tokens.push(m[0]);

  // 6. Numbers with context
  for (const m of text.matchAll(/[#vV]?\d[\d.,:-]+\w*/g)) tokens.push(m[0]);
  for (const m of text.matchAll(/\b[A-Z]+\d+\b/g)) tokens.push(m[0]);

  // 7. CJK name+title patterns
  for (const m of text.matchAll(
    /[\u4e00-\u9fff]{1,4}(?:\u603B|\u7ECF\u7406|\u8001\u5E08|\u90E8\u957F|\u4E3B\u4EFB|\u5148\u751F|\u5973\u58EB|\u540C\u5B66|\u533B\u751F|\u5F8B\u5E08|\u6559\u6388|\u535A\u58EB)/g,
  ))
    tokens.push(m[0]);

  // 8. @ mentions and # hashtags
  for (const m of text.matchAll(/[@#][\w\u4e00-\u9fff]+/g)) tokens.push(m[0]);

  // Dedupe
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of tokens) {
    const trimmed = t.trim();
    if (!trimmed || trimmed.length < 2) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
    if (result.length >= maxKeywords) break;
  }
  return result.join(" ");
}

function normalizeInsightsPayload(payload: unknown): JsonObject {
  const root =
    payload && typeof payload === "object" && !Array.isArray(payload) && (payload as any).insights
      ? (payload as any).insights
      : payload;
  const data = root && typeof root === "object" && !Array.isArray(root) ? (root as any) : {};

  const stringList = (values: unknown): string[] => {
    if (!Array.isArray(values)) return [];
    const out: string[] = [];
    for (const item of values) {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        const val = String(item).trim();
        if (val) out.push(val);
        continue;
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        for (const key of ["title", "name", "label", "value", "id"]) {
          const v = (item as any)[key];
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            const val = String(v).trim();
            if (val) out.push(val);
            break;
          }
        }
      }
    }
    return out;
  };

  const dictList = (values: unknown): JsonObject[] => {
    if (!Array.isArray(values)) return [];
    return values.filter((v) => v && typeof v === "object" && !Array.isArray(v)) as JsonObject[];
  };

  const cardList = (values: unknown): JsonObject[] => {
    if (!Array.isArray(values)) return [];
    const cards: JsonObject[] = [];
    for (const raw of values) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const card: JsonObject = { ...(raw as JsonObject) };
      if ("tags" in card) card.tags = stringList(card.tags);
      if ("methods" in card) card.methods = stringList(card.methods);
      if ("evidence" in card) {
        const evidenceOut: JsonObject[] = [];
        const ev = card.evidence;
        if (Array.isArray(ev)) {
          for (const item of ev) {
            if (typeof item === "string") {
              const snippet = item.trim();
              if (snippet) evidenceOut.push({ snippet, source: "" });
              continue;
            }
            if (item && typeof item === "object" && !Array.isArray(item)) {
              const snippet = String((item as any).snippet ?? "").trim();
              const source = String((item as any).source ?? "").trim();
              if (snippet || source) {
                evidenceOut.push({ snippet, source });
              }
            }
          }
        }
        card.evidence = evidenceOut;
      }
      cards.push(card);
    }
    return cards;
  };

  const normalized: JsonObject = {
    knowledge_cards: cardList(data.knowledge_cards),
    risks: dictList(data.risks),
    action_items: dictList(data.action_items),
  };
  for (const key of ["entities", "relations", "source_date", "source_texts"]) {
    if (key in data) {
      normalized[key] = data[key];
    }
  }
  return normalized;
}

export class AwarenessInterceptor {
  private readonly client: MemoryCloudClient;
  private readonly memoryId: string;
  private readonly source: string;
  private readonly userId?: string;
  private readonly agentRole?: string;
  private readonly retrieveLimit: number;
  private readonly maxContextChars: number;
  private readonly minRelevanceScore: number;
  private readonly maxInjectItems: number;
  private readonly autoRemember: boolean;
  private readonly enableExtraction: boolean;
  private readonly extractionModel?: string;
  private readonly extractionMaxTokens: number;
  private readonly queryRewrite: "none" | "rule" | "llm";
  private readonly onError: "warn" | "raise" | "ignore";
  private _sessionId: string;

  // Captured original LLM create functions for extraction
  private _originalOpenAICreate?: (...args: any[]) => any;
  private _originalAnthropicCreate?: (...args: any[]) => any;
  private _originalFn?: (...args: any[]) => any;

  // Agent profile system prompt (injected before memory context)
  private _agentSystemPrompt: string = "";

  private constructor(config: AwarenessInterceptorConfig, sessionId: string) {
    this.client = config.client;
    this.memoryId = config.memoryId;
    this.source = config.source ?? "interceptor";
    this.userId = config.userId;
    this.agentRole = config.agentRole;
    this.retrieveLimit = config.retrieveLimit ?? 8;
    this.maxContextChars = config.maxContextChars ?? 4000;
    this.minRelevanceScore = config.minRelevanceScore ?? 0.5;
    this.maxInjectItems = config.maxInjectItems ?? 5;
    this.autoRemember = config.autoRemember ?? true;
    this.enableExtraction = config.enableExtraction ?? true;
    this.extractionModel = config.extractionModel;
    this.extractionMaxTokens =
      config.extractionMaxTokens ??
      readPositiveIntEnv("AWARENESS_EXTRACTION_MAX_TOKENS") ??
      DEFAULT_EXTRACTION_MAX_TOKENS;
    this.queryRewrite = config.queryRewrite ?? "rule";
    this.onError = config.onError ?? "warn";
    this._sessionId = sessionId;
  }

  /**
   * Factory method — use instead of constructor (needs async session init).
   */
  static async create(config: AwarenessInterceptorConfig): Promise<AwarenessInterceptor> {
    let sessionId = config.sessionId;
    if (!sessionId) {
      const prefix = config.source ?? "interceptor";
      sessionId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    const instance = new AwarenessInterceptor(config, sessionId);

    // Fetch agent profile system prompt if agent role is configured
    if (config.agentRole) {
      try {
        const prompt = await config.client.getAgentPrompt({
          memoryId: config.memoryId,
          agentRole: config.agentRole,
        });
        if (prompt) {
          instance._agentSystemPrompt = prompt;
        }
      } catch {
        // Agent prompt fetch is optional — continue without it
      }
    }

    return instance;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  // ------------------------------------------------------------------
  // Memory retrieval
  // ------------------------------------------------------------------

  private async retrieveContextFromMessages(messages: Message[]): Promise<string> {
    if (this.queryRewrite === "llm") {
      const { semantic, keywords } = await this.rewriteQueryWithLLM(messages);
      return this.retrieveContext(semantic, keywords);
    }
    // Rule-based: Layer 1 (context) + Layer 2 (structural keywords)
    const contextQuery = buildContextQuery(messages);
    const lastUser = extractLastUserMessage(messages);
    const semantic = contextQuery || lastUser;
    const keywords = extractKeywords(contextQuery || lastUser);
    return this.retrieveContext(semantic, keywords);
  }

  private async rewriteQueryWithLLM(messages: Message[]): Promise<{ semantic: string; keywords: string }> {
    const lastUser = extractLastUserMessage(messages);
    try {
      // Build compact context
      const contextLines: string[] = [];
      let total = 0;
      let turns = 0;
      for (let i = messages.length - 1; i >= 0 && turns < 4; i--) {
        const msg = messages[i];
        if (msg?.role !== "user" && msg?.role !== "assistant") continue;
        let content = extractTextContent(msg);
        if (!content.trim()) continue;
        if (content.length > 300) content = content.slice(0, 300);
        contextLines.push(`[${msg.role}]: ${content}`);
        total += content.length;
        turns++;
        if (total >= 1200) break;
      }
      contextLines.reverse();
      const userContent = "Conversation context:\n" + contextLines.join("\n");

      const rawText = await this.callLLMForExtraction(REWRITE_SYSTEM_PROMPT, userContent);
      if (!rawText) return { semantic: lastUser, keywords: extractKeywords(lastUser) };

      const parsed = JSON.parse(coerceJsonObjectText(rawText));
      const semantic = parsed?.semantic_query?.trim() || lastUser;
      let keywords = parsed?.keyword_query?.trim() || "";
      if (!keywords) {
        const ctx = buildContextQuery(messages);
        keywords = extractKeywords(ctx || lastUser);
      }
      return { semantic, keywords };
    } catch (e) {
      return { semantic: lastUser, keywords: extractKeywords(lastUser) };
    }
  }

  private async retrieveContext(query: string, keywordQuery: string = ""): Promise<string> {
    if (!query.trim()) return "";
    try {
      const metadataFilter: JsonObject = {};
      if (this.userId) metadataFilter.user_id = this.userId;
      if (this.agentRole) metadataFilter.agent_role = this.agentRole;

      const result = await this.client.retrieve({
        memoryId: this.memoryId,
        query,
        keywordQuery: keywordQuery || undefined,
        limit: this.retrieveLimit,
        metadataFilter: Object.keys(metadataFilter).length > 0 ? metadataFilter : undefined,
      });
      let items: any[] = (result as any)?.results ?? [];
      if (items.length === 0) return "";

      // Filter by relevance score and cap inject count
      items = items.filter(
        (item: any) => item?.score === undefined || item?.score === null || item.score >= this.minRelevanceScore
      );
      items = items.slice(0, this.maxInjectItems);
      if (items.length === 0) return "";

      const parts: string[] = [];
      let totalChars = 0;
      for (const item of items) {
        const content = String(item?.content ?? "");
        if (totalChars + content.length > this.maxContextChars) break;
        parts.push(content);
        totalChars += content.length;
      }
      if (parts.length === 0) {
        return this._agentSystemPrompt ? `${this._agentSystemPrompt}\n\n` : "";
      }
      const memoryBlock = "[Relevant memories]\n" + parts.join("\n---\n") + "\n[End memories]\n\n";
      return this._agentSystemPrompt
        ? `${this._agentSystemPrompt}\n\n${memoryBlock}`
        : memoryBlock;
    } catch (e) {
      this.handleError(`Memory retrieval failed: ${e}`);
      return this._agentSystemPrompt ? `${this._agentSystemPrompt}\n\n` : "";
    }
  }

  // ------------------------------------------------------------------
  // Background storage + extraction
  // ------------------------------------------------------------------

  private storeInBackground(userText: string, assistantText: string): void {
    if (!this.autoRemember) return;

    // Fire-and-forget: don't await
    const doStore = async () => {
      let extractionReq: ExtractionRequest | null = null;
      try {
        const events: Array<{ content: string; event_type?: string; source?: string }> = [];
        if (userText.trim()) {
          events.push({
            content: `[user] ${userText}`,
            event_type: "message",
            source: this.source,
          });
        }
        if (assistantText.trim()) {
          events.push({
            content: `[assistant] ${assistantText}`,
            event_type: "message",
            source: this.source,
          });
        }
        if (events.length > 0) {
          const result = await this.client.record({
            memoryId: this.memoryId,
            content: events.map((e) => ({
              content: e.content,
              event_type: e.event_type,
              source: e.source,
              session_id: this._sessionId,
            })),
            sessionId: this._sessionId,
            source: this.source,
            userId: this.userId,
          });
          if (result && typeof result === "object" && "extraction_request" in result) {
            extractionReq = (result as any).extraction_request;
          }
        }
      } catch (e) {
        console.warn(`Background memory storage failed: ${e}`);
      }

      // Run extraction if we got a request
      if (extractionReq && this.enableExtraction) {
        await this.runExtraction(extractionReq);
      }
    };
    doStore(); // fire-and-forget
  }

  private async runExtraction(extractionRequest: ExtractionRequest): Promise<void> {
    try {
      const systemPrompt = extractionRequest.system_prompt ?? "";
      const events = extractionRequest.events ?? [];
      const existingCards = extractionRequest.existing_cards ?? [];

      // Replace {existing_cards} placeholder in prompt
      const cardsJson = existingCards.length > 0 ? JSON.stringify(existingCards, null, 2) : "[]";
      const filledPrompt = systemPrompt.replace("{existing_cards}", cardsJson);
      const compactEvents = compactEventsForExtraction(events);
      const userContent = JSON.stringify({ events: compactEvents });

      const text = await this.callLLMForExtraction(filledPrompt, userContent);
      if (!text) return;
      let parsed: JsonObject;
      try {
        parsed = parseInsightsPayload(text);
      } catch (parseErr) {
        console.warn(`Extraction payload parse failed, retrying with stricter JSON prompt: ${parseErr}`);
        const retryPrompt =
          "Return one valid JSON object only. Do not include markdown/code fences/explanations. " +
          "Required keys: knowledge_cards, risks, action_items.\n\n" +
          filledPrompt;
        const retryContent = JSON.stringify({ events: compactEvents.slice(0, 8) });
        const retryText = await this.callLLMForExtraction(retryPrompt, retryContent);
        if (!retryText) return;
        parsed = parseInsightsPayload(retryText);
      }

      // Extract turn_brief before normalization
      const turnBrief = typeof parsed.turn_brief === "string" ? (parsed.turn_brief as string).trim() : "";
      delete parsed.turn_brief;

      const insights = normalizeInsightsPayload(parsed);

      // Submit to server (server-side dedup)
      await (this.client as any)._submitInsights({
        memoryId: this.memoryId,
        insights,
        sessionId: extractionRequest.session_id ?? this._sessionId,
        userId: this.userId,
        agentRole: this.agentRole,
      });

      const cards = Array.isArray((insights as any)?.knowledge_cards)
        ? (insights as any).knowledge_cards.length
        : 0;
      const risks = Array.isArray((insights as any)?.risks) ? (insights as any).risks.length : 0;
      const actions = Array.isArray((insights as any)?.action_items)
        ? (insights as any).action_items.length
        : 0;
      console.log(`Extraction complete: ${cards} cards, ${risks} risks, ${actions} actions`);

      // Store turn_brief as a special event for DAILY_NARRATIVE write-through
      if (turnBrief) {
        try {
          await this.client.record({
            memoryId: this.memoryId,
            content: [{
              content: turnBrief,
              actor: "system",
              event_type: "turn_brief",
              source: this.source,
              session_id: extractionRequest.session_id ?? this._sessionId,
            }],
            sessionId: extractionRequest.session_id ?? this._sessionId,
            source: this.source,
            userId: this.userId ?? undefined,
          });
          console.log(`Turn brief stored: ${turnBrief.slice(0, 80)}`);
        } catch (tbErr) {
          console.warn(`Turn brief storage failed: ${tbErr}`);
        }
      }
    } catch (e) {
      console.warn(`Background extraction failed: ${e}`);
      if (e instanceof Error && e.stack) {
        console.warn(e.stack);
      }
    }
  }

  private async callLLMForExtraction(systemPrompt: string, userContent: string): Promise<string> {
    if (this._originalOpenAICreate) {
      const model = this.extractionModel ?? "gpt-4o-mini";
      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ];
      let response: any;
      try {
        response = await this._originalOpenAICreate({
          model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: this.extractionMaxTokens,
        });
      } catch (err) {
        const msg = String(err ?? "").toLowerCase();
        if (!msg.includes("response_format")) throw err;
        response = await this._originalOpenAICreate({
          model,
          messages: [
            {
              role: "system",
              content:
                "Return one valid JSON object only. No markdown, no code fence, no extra commentary.",
            },
            ...messages,
          ],
          temperature: 0,
          max_tokens: this.extractionMaxTokens,
        });
      }
      return extractAssistantTextOpenAI(response);
    }

    if (this._originalAnthropicCreate) {
      const model = this.extractionModel ?? "claude-haiku-4-5-20251001";
      const response = await this._originalAnthropicCreate({
        model,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
        max_tokens: this.extractionMaxTokens,
      });
      return extractAssistantTextAnthropic(response);
    }

    if (this._originalFn) {
      const response = await this._originalFn({
        model: this.extractionModel ?? "gpt-4o-mini",
        temperature: 0,
        max_tokens: this.extractionMaxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      });
      return extractAssistantTextOpenAI(response);
    }

    console.warn("No original LLM function available for extraction");
    return "";
  }

  // ------------------------------------------------------------------
  // OpenAI wrapping
  // ------------------------------------------------------------------

  wrapOpenAI(openaiClient: any): void {
    const completions = openaiClient.chat.completions;
    const originalCreate = completions.create.bind(completions);
    this._originalOpenAICreate = originalCreate;
    const interceptor = this;

    completions.create = async function (...args: any[]) {
      // Support both positional and keyword args
      const kwargs = args[0] && typeof args[0] === "object" ? args[0] : {};
      const messages: Message[] = [...(kwargs.messages ?? [])];

      // PRE-call: inject memory context (with query rewriting)
      const userText = extractLastUserMessage(messages);
      const memoryContext =
        interceptor.queryRewrite !== "none"
          ? await interceptor.retrieveContextFromMessages(messages)
          : await interceptor.retrieveContext(userText);

      if (memoryContext) {
        if (messages.length > 0 && messages[0]?.role === "system") {
          messages[0] = {
            ...messages[0],
            content: memoryContext + String(messages[0].content ?? ""),
          };
        } else {
          messages.unshift({ role: "system", content: memoryContext });
        }
        kwargs.messages = messages;
      }

      const response = await originalCreate(kwargs);

      // POST-call: store in background
      const assistantText = extractAssistantTextOpenAI(response);
      interceptor.storeInBackground(userText, assistantText);

      return response;
    };
  }

  // ------------------------------------------------------------------
  // Anthropic wrapping
  // ------------------------------------------------------------------

  wrapAnthropic(anthropicClient: any): void {
    const messagesApi = anthropicClient.messages;
    const originalCreate = messagesApi.create.bind(messagesApi);
    this._originalAnthropicCreate = originalCreate;
    const interceptor = this;

    messagesApi.create = async function (...args: any[]) {
      const kwargs = args[0] && typeof args[0] === "object" ? args[0] : {};
      const messages: Message[] = [...(kwargs.messages ?? [])];

      // PRE-call: inject memory context (with query rewriting)
      const userText = extractLastUserMessage(messages);
      const memoryContext =
        interceptor.queryRewrite !== "none"
          ? await interceptor.retrieveContextFromMessages(messages)
          : await interceptor.retrieveContext(userText);

      if (memoryContext) {
        const system = kwargs.system;
        if (typeof system === "string") {
          kwargs.system = memoryContext + system;
        } else if (Array.isArray(system)) {
          kwargs.system = [{ type: "text", text: memoryContext }, ...system];
        } else {
          kwargs.system = memoryContext;
        }
      }

      const response = await originalCreate(kwargs);

      // POST-call: store in background
      const assistantText = extractAssistantTextAnthropic(response);
      interceptor.storeInBackground(userText, assistantText);

      return response;
    };
  }

  // ------------------------------------------------------------------
  // Generic function wrapping (LiteLLM, etc.)
  // ------------------------------------------------------------------

  registerFunction<T extends (...args: any[]) => any>(fn: T): T {
    this._originalFn = fn;
    const interceptor = this;

    const wrapped = async function (...args: any[]) {
      const kwargs = args[0] && typeof args[0] === "object" ? args[0] : {};
      const messages: Message[] = [...(kwargs.messages ?? [])];

      // PRE-call: inject memory (with query rewriting)
      const userText = extractLastUserMessage(messages);
      const memoryContext =
        interceptor.queryRewrite !== "none"
          ? await interceptor.retrieveContextFromMessages(messages)
          : await interceptor.retrieveContext(userText);

      if (memoryContext) {
        if (messages.length > 0 && messages[0]?.role === "system") {
          messages[0] = {
            ...messages[0],
            content: memoryContext + String(messages[0].content ?? ""),
          };
        } else {
          messages.unshift({ role: "system", content: memoryContext });
        }
        kwargs.messages = messages;
      }

      const response = await fn(...args);

      // POST-call: store in background
      const assistantText = extractAssistantTextOpenAI(response);
      interceptor.storeInBackground(userText, assistantText);

      return response;
    };

    return wrapped as T;
  }

  // ------------------------------------------------------------------
  // Error handling
  // ------------------------------------------------------------------

  private handleError(message: string): void {
    if (this.onError === "raise") {
      throw new Error(message);
    } else if (this.onError === "warn") {
      console.warn(message);
    }
    // "ignore" — do nothing
  }
}
