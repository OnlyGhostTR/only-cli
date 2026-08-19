/**
 * Godot executable discovery.
 *
 * The godot-mcp server can auto-detect Godot, but only in a handful of
 * standard locations. On Windows people usually keep the portable
 * `Godot_v4.x-stable_win64.exe` wherever they downloaded it, so we resolve the
 * path ourselves and hand it to the server through `GODOT_PATH`.
 */
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { basename, delimiter, join } from 'node:path';
/** Windows: portable builds are named `Godot_v4.7.2-stable_win64.exe` etc. */
const WINDOWS_BINARY_PATTERN = /^godot.*\.exe$/i;
/** Names to look for when scanning `PATH`. */
const PATH_BINARY_NAMES = platform() === 'win32'
    ? ['godot.exe', 'godot4.exe']
    : ['godot', 'godot4'];
/** Release channels, best first. Unknown channels sort between rc and beta. */
const CHANNEL_RANK = {
    stable: 5,
    rc: 4,
    beta: 2,
    alpha: 1,
    dev: 0,
};
/**
 * Find the Godot executable.
 *
 * Priority: `GODOT_PATH` > `PATH` > well-known install/download folders.
 * Returns `null` when nothing usable is found; callers should tell the user to
 * set `GODOT_PATH` rather than guessing.
 */
export async function resolveGodotPath() {
    const fromEnv = process.env['GODOT_PATH']?.trim();
    if (fromEnv && (await isExecutableFile(fromEnv)))
        return fromEnv;
    const fromPath = await findOnPath();
    if (fromPath)
        return fromPath;
    return findInCommonDirs();
}
/**
 * Pick the most desirable binary out of several candidate file names.
 *
 * Prefers the highest version, then the most stable channel, then the
 * non-console variant (the `_console` build pops up an extra terminal window).
 * Exported for testing.
 */
export function pickBestGodotBinary(names) {
    const usable = names.filter((name) => !/uninstall|crash|handler/i.test(name));
    if (usable.length === 0)
        return null;
    let best = usable[0];
    for (const candidate of usable.slice(1)) {
        if (compareGodotBinaries(candidate, best) > 0)
            best = candidate;
    }
    return best;
}
/** Positive when `a` is preferable to `b`. */
function compareGodotBinaries(a, b) {
    const scoreA = scoreBinary(a);
    const scoreB = scoreBinary(b);
    for (let i = 0; i < scoreA.length; i += 1) {
        const diff = scoreA[i] - scoreB[i];
        if (diff !== 0)
            return diff;
    }
    return 0;
}
/** [major, minor, patch, channel, non-console] — all "higher is better". */
function scoreBinary(name) {
    const file = basename(name);
    const version = /v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(file);
    const channel = /-(stable|rc\d*|beta\d*|alpha\d*|dev\d*)/i.exec(file);
    const channelName = channel?.[1]?.toLowerCase().replace(/\d+$/, '') ?? '';
    const channelRank = channelName in CHANNEL_RANK
        ? CHANNEL_RANK[channelName]
        : 3;
    return [
        Number(version?.[1] ?? 0),
        Number(version?.[2] ?? 0),
        Number(version?.[3] ?? 0),
        channelRank,
        /_console/i.test(file) ? 0 : 1,
    ];
}
async function findOnPath() {
    const rawPath = process.env['PATH'] ?? process.env['Path'];
    if (!rawPath)
        return null;
    for (const dir of rawPath.split(delimiter)) {
        if (!dir.trim())
            continue;
        for (const name of PATH_BINARY_NAMES) {
            const candidate = join(dir, name);
            if (await isExecutableFile(candidate))
                return candidate;
        }
    }
    return null;
}
async function findInCommonDirs() {
    const found = [];
    for (const dir of commonDirs()) {
        found.push(...(await scanDir(dir, 1)));
    }
    return pickBestGodotBinary(found);
}
function commonDirs() {
    const home = homedir();
    if (platform() === 'win32') {
        const localAppData = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');
        const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
        return [
            join(home, 'Desktop'),
            join(home, 'Downloads'),
            join(localAppData, 'Programs'),
            join(programFiles, 'Godot'),
            join(programFilesX86, 'Godot'),
            join(programFilesX86, 'Steam', 'steamapps', 'common', 'Godot Engine'),
            'C:\\Godot',
        ];
    }
    return [
        '/usr/local/bin',
        '/usr/bin',
        '/snap/bin',
        join(home, '.local', 'bin'),
        join(home, 'Applications'),
        '/Applications/Godot.app/Contents/MacOS',
        '/Applications',
    ];
}
/** Collect Godot-looking executables in `dir`, descending `depth` levels. */
async function scanDir(dir, depth) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        // Missing or unreadable directory: nothing to report.
        return [];
    }
    const results = [];
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            // macOS bundles: /Applications/Godot.app/Contents/MacOS/Godot
            if (entry.name.toLowerCase().endsWith('.app')) {
                results.push(...(await scanDir(join(full, 'Contents', 'MacOS'), 0)));
            }
            else if (depth > 0 && /godot/i.test(entry.name)) {
                results.push(...(await scanDir(full, depth - 1)));
            }
            continue;
        }
        if (!matchesBinaryName(entry.name))
            continue;
        if (await isExecutableFile(full))
            results.push(full);
    }
    return results;
}
function matchesBinaryName(name) {
    if (platform() === 'win32')
        return WINDOWS_BINARY_PATTERN.test(name);
    return /^godot/i.test(name) && !name.includes('.');
}
async function isExecutableFile(path) {
    try {
        const info = await stat(path);
        if (!info.isFile())
            return false;
    }
    catch {
        return false;
    }
    if (platform() === 'win32')
        return true;
    try {
        await access(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=godot.js.map