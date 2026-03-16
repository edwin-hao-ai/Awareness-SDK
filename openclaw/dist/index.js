"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHooks = exports.registerTools = exports.AwarenessClient = void 0;
exports.default = register;
const client_1 = require("./client");
const tools_1 = require("./tools");
const hooks_1 = require("./hooks");
// ---------------------------------------------------------------------------
// Plugin entry point — called by the OpenClaw host to initialize the plugin
// ---------------------------------------------------------------------------
function register(api) {
    const raw = api.config;
    // Resolve config with defaults matching openclaw.plugin.json configSchema
    const config = {
        apiKey: raw.apiKey,
        baseUrl: raw.baseUrl ?? "https://awareness.market/api/v1",
        memoryId: raw.memoryId,
        agentRole: raw.agentRole ?? "builder_agent",
        autoRecall: raw.autoRecall !== undefined ? raw.autoRecall : true,
        autoCapture: raw.autoCapture !== undefined ? raw.autoCapture : true,
        recallLimit: raw.recallLimit !== undefined ? raw.recallLimit : 8,
    };
    // Validate required fields
    if (!config.apiKey) {
        throw new Error("Awareness plugin: apiKey is required. " +
            "Set it in your openclaw.json plugins config.");
    }
    if (!config.memoryId) {
        throw new Error("Awareness plugin: memoryId is required. " +
            "Set it in your openclaw.json plugins config.");
    }
    // Create the HTTP client
    const client = new client_1.AwarenessClient(config.baseUrl, config.apiKey, config.memoryId, config.agentRole);
    // Register tools and hooks
    (0, tools_1.registerTools)(api, client);
    (0, hooks_1.registerHooks)(api, client, config);
    api.logger.info(`Awareness memory plugin initialized — ` +
        `memory=${config.memoryId}, role=${config.agentRole}, ` +
        `autoRecall=${config.autoRecall}, autoCapture=${config.autoCapture}`);
}
// Re-export types and client for programmatic usage
var client_2 = require("./client");
Object.defineProperty(exports, "AwarenessClient", { enumerable: true, get: function () { return client_2.AwarenessClient; } });
var tools_2 = require("./tools");
Object.defineProperty(exports, "registerTools", { enumerable: true, get: function () { return tools_2.registerTools; } });
var hooks_2 = require("./hooks");
Object.defineProperty(exports, "registerHooks", { enumerable: true, get: function () { return hooks_2.registerHooks; } });
