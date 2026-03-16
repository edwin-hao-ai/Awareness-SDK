/**
 * OpenClaw Native Adapter
 *
 * Bridges the Awareness plugin to OpenClaw's real plugin API.
 * The core logic lives in client.ts/tools.ts/hooks.ts;
 * this file just adapts the registration and config parsing to match
 * the OpenClaw host runtime (api.pluginConfig, api.on, api.registerTool).
 */
interface AwarenessPluginConfig {
    apiKey: string;
    baseUrl: string;
    memoryId: string;
    agentRole: string;
    autoRecall: boolean;
    autoCapture: boolean;
    recallLimit: number;
}
declare const awarenessPlugin: {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    configSchema: {
        parse(value: unknown): AwarenessPluginConfig;
    };
    register(api: any): void;
};
export default awarenessPlugin;
