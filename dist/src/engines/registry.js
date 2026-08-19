/**
 * Game engine registry - defines all supported engines
 */
/**
 * Community MCP server for Godot. Pinned so a breaking upstream release can't
 * silently change the tool surface underneath us.
 */
export const GODOT_MCP_PACKAGE = '@coding-solo/godot-mcp@0.1.1';
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
        status: 'active',
        icon: '🤖',
        description: 'Scene/node editing and project execution via the godot-mcp server',
        mcp: {
            // Runs the community godot-mcp server straight from npm. On Windows the
            // npx shim is a .cmd file, so it needs cmd.exe: cross-spawn launches the
            // command without a shell.
            command: process.platform === 'win32' ? 'cmd.exe' : 'npx',
            args: process.platform === 'win32'
                ? ['/c', 'npx', '-y', GODOT_MCP_PACKAGE]
                : ['-y', GODOT_MCP_PACKAGE],
            // GODOT_PATH is filled in at connect time by resolveGodotPath().
        },
        features: [
            'Scene creation and saving',
            'Node creation and modification',
            'Sprite/texture loading',
            'MeshLibrary export',
            'Launch editor and run projects',
            'Capture debug output',
            'Project listing and info',
            'Resource UID management (Godot 4.4+)',
        ],
        docs: 'https://github.com/Coding-Solo/godot-mcp',
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