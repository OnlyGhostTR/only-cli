/**
 * Game engine registry - defines all supported engines
 */
export const ENGINES = {
    'roblox-studio': {
        id: 'roblox-studio',
        name: 'roblox-studio',
        displayName: 'Roblox Studio',
        status: 'active',
        icon: '🎮',
        description: 'Full integration with Roblox Studio via built-in MCP server',
        mcp: {
            command: 'cmd.exe',
            args: ['/c', '%LOCALAPPDATA%\\Roblox\\mcp.bat'],
            env: {
            // Ensure proper environment for the MCP server
            },
        },
        features: [
            'Luau script editing',
            '3D model creation and manipulation',
            'UI/ScreenGui design',
            'Instance tree navigation',
            'Property editing',
            'Playtest automation',
            'Player input simulation',
            'Screenshot capture',
            'DataStore operations',
            'RemoteEvent/Function handling',
        ],
        docs: 'https://create.roblox.com/docs/studio/mcp',
    },
    godot: {
        id: 'godot',
        name: 'godot',
        displayName: 'Godot Engine',
        status: 'coming-soon',
        icon: '🤖',
        description: 'GDScript support with scene and node manipulation',
        mcp: {
            command: 'godot',
            args: ['--headless', '--mcp'],
        },
        features: [
            'GDScript editing',
            'Scene manipulation',
            'Node creation and modification',
            'Resource management',
            'Signal connections',
            'Project settings',
        ],
    },
    unity: {
        id: 'unity',
        name: 'unity',
        displayName: 'Unity',
        status: 'coming-soon',
        icon: '🎯',
        description: 'C# scripting and GameObject manipulation for Unity Editor',
        mcp: {
            command: 'unity-mcp-server',
            args: [],
        },
        features: [
            'C# script editing',
            'GameObject manipulation',
            'Component editing',
            'Asset management',
            'Scene hierarchy',
            'Prefab creation',
        ],
    },
    unreal: {
        id: 'unreal',
        name: 'unreal',
        displayName: 'Unreal Engine',
        status: 'coming-soon',
        icon: '⚡',
        description: 'Blueprint and C++ support for Unreal Engine',
        mcp: {
            command: 'unreal-mcp-server',
            args: [],
        },
        features: [
            'Blueprint editing',
            'C++ scripting',
            'Actor manipulation',
            'Level design',
            'Material editing',
            'Animation setup',
        ],
    },
};
/**
 * Get engine config by ID
 */
export function getEngine(id) {
    return ENGINES[id];
}
/**
 * Get all engines
 */
export function getAllEngines() {
    return Object.values(ENGINES);
}
/**
 * Get active engines only
 */
export function getActiveEngines() {
    return getAllEngines().filter(e => e.status === 'active');
}
/**
 * Check if engine ID is valid
 */
export function isValidEngineId(id) {
    return id in ENGINES;
}
//# sourceMappingURL=registry.js.map