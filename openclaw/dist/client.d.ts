import type { RecallResult, SessionContext, IngestResponse, SupersedeResponse } from "./types";
export interface SearchOptions {
    semanticQuery: string;
    keywordQuery?: string;
    scope?: "all" | "timeline" | "knowledge" | "insights";
    limit?: number;
    vectorWeight?: number;
    fullTextWeight?: number;
    recallMode?: "precise" | "session" | "structured" | "hybrid" | "auto";
    /** Enable broader context retrieval across sessions and time ranges. */
    multiLevel?: boolean;
    /** Enable topic-based context expansion for deeper exploration. */
    clusterExpand?: boolean;
    /** Minimum confidence threshold for structured/hybrid cards. */
    confidenceThreshold?: number;
    /** Search installed marketplace memories. */
    includeInstalled?: boolean;
    /** Multi-user filtering. */
    userId?: string;
}
export declare class AwarenessClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly memoryId;
    private readonly agentRole;
    readonly sessionId: string;
    constructor(baseUrl: string, apiKey: string, memoryId: string, agentRole?: string);
    init(days?: number, maxCards?: number, maxTasks?: number): Promise<{
        session_id: string;
        context: SessionContext;
    }>;
    search(opts: SearchOptions): Promise<RecallResult>;
    getData(type: string, params?: Record<string, unknown>): Promise<unknown>;
    write(action: string, params?: Record<string, unknown>): Promise<unknown>;
    private getSessionContext;
    private getKnowledgeBase;
    private getPendingTasks;
    private getRisks;
    private getSessionHistory;
    private getTimeline;
    private getHandoffContext;
    private getRules;
    private getGraph;
    private getAgents;
    rememberStep(text: string, metadata?: Record<string, unknown>, userId?: string): Promise<IngestResponse>;
    private rememberBatch;
    private ingestContent;
    private updateTask;
    closeSession(): Promise<{
        session_id: string;
        events_processed: number;
    }>;
    private submitInsights;
    private backfillConversation;
    supersedeCard(cardId: string): Promise<SupersedeResponse>;
    private headers;
    get<T>(path: string, params?: URLSearchParams): Promise<T>;
    private post;
    private patch;
    private extractErrorDetail;
}
