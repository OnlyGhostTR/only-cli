/**
 * Generic MCP client for connecting to game engines
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { VERSION } from '../version.js';
/**
 * Connect to an engine's MCP server
 */
export async function connectToEngine(config) {
    const transport = new StdioClientTransport({
        command: config.mcp.command,
        args: config.mcp.args,
        env: config.mcp.env,
    });
    const client = new Client({
        name: 'onlycli',
        version: VERSION,
    }, {
        capabilities: {},
    });
    await client.connect(transport);
    // Get available tools - handle schema validation issues with Roblox Studio MCP
    let tools = [];
    try {
        const toolsResult = await client.listTools();
        // Map tools and sanitize schemas
        tools = toolsResult.tools.map((tool) => {
            let inputSchema = tool.inputSchema;
            // Clean up __hidden_* properties
            if (inputSchema && typeof inputSchema === 'object' && 'properties' in inputSchema) {
                const properties = inputSchema.properties;
                if (properties && typeof properties === 'object') {
                    const cleaned = {};
                    for (const [key, value] of Object.entries(properties)) {
                        if (!key.startsWith('__hidden_')) {
                            cleaned[key] = value;
                        }
                    }
                    inputSchema = { ...inputSchema, properties: cleaned };
                }
            }
            return {
                name: tool.name,
                description: tool.description || '',
                inputSchema,
            };
        });
    }
    catch (error) {
        // Schema validation failed - try manual tool discovery
        // This is needed for Roblox Studio MCP which uses __hidden_json_table
        console.warn('Schema validation failed, attempting manual tool discovery...');
        try {
            // Send raw JSON-RPC request to bypass SDK validation
            const response = await client._transport.send({
                jsonrpc: '2.0',
                id: Math.random().toString(36).substring(7),
                method: 'tools/list',
                params: {},
            });
            if (response && response.result && Array.isArray(response.result.tools)) {
                tools = response.result.tools.map((tool) => {
                    let inputSchema = tool.inputSchema;
                    // Clean up __hidden_* properties
                    if (inputSchema && typeof inputSchema === 'object' && inputSchema.properties) {
                        const properties = inputSchema.properties;
                        if (properties && typeof properties === 'object') {
                            const cleaned = {};
                            for (const [key, value] of Object.entries(properties)) {
                                if (!key.startsWith('__hidden_')) {
                                    cleaned[key] = value;
                                }
                            }
                            inputSchema = { ...inputSchema, properties: cleaned };
                        }
                    }
                    return {
                        name: tool.name || '',
                        description: tool.description || '',
                        inputSchema,
                    };
                });
                console.log(`Manual discovery successful: found ${tools.length} tools`);
            }
        }
        catch (manualError) {
            console.error('Manual tool discovery also failed:', manualError);
        }
    }
    return {
        engine: config.id,
        connected: true,
        client,
        tools,
    };
}
/**
 * Disconnect from MCP server
 */
export async function disconnectFromEngine(connection) {
    if (connection.client && connection.connected) {
        await connection.client.close();
    }
}
/**
 * Call an MCP tool
 */
export async function callTool(connection, toolName, args) {
    if (!connection.connected) {
        throw new Error('Not connected to engine');
    }
    const result = await connection.client.callTool({
        name: toolName,
        arguments: args,
    });
    return result;
}
/**
 * List available tools for connected engine
 */
export function getAvailableTools(connection) {
    return connection.tools;
}
//# sourceMappingURL=mcp-client.js.map