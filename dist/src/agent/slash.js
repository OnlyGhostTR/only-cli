/**
 * Parsing slash commands in interactive session.
 *
 * Parsing is kept separate from execution: so argument resolution (quoted
 * paths, aliases) can be tested without UI or filesystem.
 */
/** Alias → canonical name. */
const ALIASES = {
    "?": "help",
    h: "help",
    q: "exit",
    quit: "exit",
    bye: "exit",
    dir: "ls",
    cwd: "pwd",
    add: "file",
    reset: "clear",
    new: "clear",
    endpoint: "baseurl",
    "base-url": "baseurl",
    url: "baseurl",
    local: "disk",
    search: "web",
    net: "web",
    connect: "mcp",
    engine: "mcp",
    info: "status",
    v: "version",
    ver: "version",
    cls: "cls",
};
export const SLASH_COMMANDS = [
    "help",
    "exit",
    "cd",
    "pwd",
    "ls",
    "file",
    "files",
    "unfile",
    "scan",
    "clear",
    "provider",
    "model",
    "baseurl",
    "apikey",
    "auto",
    "web",
    "mcp",
    "status",
    "version",
    "cls",
];
export function isSlashCommandName(value) {
    return SLASH_COMMANDS.includes(value);
}
/**
 * If line is a slash command, parse it; otherwise return null.
 *
 * Windows paths contain backslashes, so `\` is not treated as escape;
 * only quote grouping is supported.
 */
export function parseSlash(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("/"))
        return null;
    // Lines starting with "//" are escaped (to send "/" to model).
    if (trimmed.startsWith("//"))
        return null;
    const body = trimmed.slice(1);
    if (body === "")
        return null;
    const match = /^(\S+)\s*([\s\S]*)$/.exec(body);
    if (!match)
        return null;
    const rawName = (match[1] ?? "").toLowerCase();
    const rest = (match[2] ?? "").trim();
    const name = ALIASES[rawName] ?? rawName;
    return { name, args: splitArgs(rest), rest };
}
/** Split arguments respecting quote groups. */
export function splitArgs(input) {
    const args = [];
    let current = "";
    let quote = null;
    let hasContent = false;
    for (const char of input) {
        if (quote) {
            if (char === quote) {
                quote = null;
            }
            else {
                current += char;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            hasContent = true;
            continue;
        }
        if (/\s/.test(char)) {
            if (hasContent) {
                args.push(current);
                current = "";
                hasContent = false;
            }
            continue;
        }
        current += char;
        hasContent = true;
    }
    if (hasContent)
        args.push(current);
    return args;
}
/** Command name completion suggestions based on text after "/". */
export function completeSlash(line) {
    if (!line.startsWith("/"))
        return [];
    const partial = line.slice(1).toLowerCase();
    // If whitespace, command name is complete; no argument completion.
    if (/\s/.test(partial))
        return [];
    return SLASH_COMMANDS.filter((name) => name.startsWith(partial)).map((name) => `/${name}`);
}
//# sourceMappingURL=slash.js.map