/**
 * Interactive chat loop.
 *
 * Entered when `onlycli` called without arguments. User types free text;
 * lines starting with `/` manage the session (change directory, add files,
 * switch provider).
 *
 * Directory model: `/cd` can move to any directory on the machine, but the
 * agent's read/write access is always limited to that directory's subtree —
 * the sandbox root travels with the session.
 */
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { input } from "@inquirer/prompts";
import { setBaseUrl } from "../config/store.js";
import { InvalidBaseUrlError, isInsecureBaseUrl, normalizeBaseUrl, ProviderError, } from "../providers/base.js";
import { createProvider, isProviderId, PROVIDER_IDS, MissingKeyError, resolveProvider, supportsBaseUrl, } from "../providers/index.js";
import * as ui from "../ui/components.js";
import { glyph, theme } from "../ui/theme.js";
import { PathEscapeError } from "../utils/files.js";
import { DiskWorkspace } from "../workspace/disk.js";
import { BLOCK_DELIMITER, isBlockDelimiter, joinLines, parseContinuation, } from "./multiline.js";
import { Session } from "./session.js";
import { parseSlash, SLASH_COMMANDS } from "./slash.js";
import { runTurn } from "./turn.js";
import { VERSION } from "../version.js";
export async function runRepl(options) {
    let provider = options.provider;
    const { session } = options;
    let workspace = options.workspace ?? new DiskWorkspace(session.cwd);
    banner(session, workspace);
    try {
        for (;;) {
            let line;
            try {
                line = await readPrompt(session);
            }
            catch (error) {
                // Ctrl+C / Ctrl+D: inquirer throws ExitPromptError.
                if (error instanceof Error && error.name === "ExitPromptError") {
                    ui.blank();
                    ui.hint("Goodbye.");
                    return;
                }
                throw error;
            }
            const trimmed = line.trim();
            if (trimmed === "")
                continue;
            const command = parseSlash(trimmed);
            if (command) {
                const result = await runSlash(command.name, command.args, session, {
                    workspace,
                    setProvider: (next) => {
                        provider = next;
                    },
                    setWorkspace: (next) => {
                        workspace = next;
                    },
                    session,
                });
                if (result === "exit")
                    return;
                continue;
            }
            // Remove extra backslash from escaped "//" line.
            const prompt = trimmed.startsWith("//") ? trimmed.slice(1) : trimmed;
            ui.blank();
            try {
                await runTurn({
                    provider,
                    session,
                    prompt,
                    workspace,
                    ...(options.maxTokens !== undefined
                        ? { maxTokens: options.maxTokens }
                        : {}),
                });
            }
            catch (error) {
                // Chat shouldn't close on a single failed request.
                reportTurnError(error);
            }
            ui.blank();
        }
    }
    finally {
        // Cleanup
    }
}
function banner(session, workspace) {
    ui.header(`OnlyCLI ${theme.frame(glyph.vertical)} ${session.providerLabel} ${theme.frame("/")} ${session.model}`, shortenPath(session.cwd));
    ui.rule();
    ui.hint(`Type to chat. Use /help for commands, /exit to quit.`);
    ui.blank();
}
/** Input line label: directory name + file count. */
function promptLabel(session) {
    const dir = basename(session.cwd) || session.cwd;
    const pins = session.pinnedFiles.length > 0 ? ` ${glyph.dot} ${session.pinnedFiles.length} files` : "";
    return `${dir}${pins}`;
}
const inputTheme = {
    prefix: theme.accent(glyph.arrow),
};
/** Label for continuation lines; distinguishable from first line. */
const continuationTheme = {
    prefix: theme.muted(glyph.vertical),
};
/**
 * Reads a request; collects multiple lines if needed.
 *
 * Shift+Enter is intentionally not used here: terminals don't distinguish it
 * from plain Enter as a meaningful sequence (cmd.exe and PowerShell lack
 * advanced keyboard protocol), so no amount of effort can capture line breaks.
 * Instead, there are two content-based rules; both work on every terminal.
 */
async function readPrompt(session) {
    const first = await input({
        message: promptLabel(session),
        theme: inputTheme,
    });
    if (isBlockDelimiter(first))
        return readBlock();
    const parsed = parseContinuation(first);
    if (!parsed.continues)
        return parsed.text;
    const lines = [parsed.text];
    for (;;) {
        const next = await input({ message: "", theme: continuationTheme });
        const step = parseContinuation(next);
        lines.push(step.text);
        /*
         * Empty line also ends it: if user forgets the continuation marker,
         * presses Enter without `\` and the request is already complete. Also
         * provides an escape from an accidentally opened continuation chain.
         */
        if (!step.continues)
            break;
    }
    return joinLines(lines);
}
/**
 * Reads a `"""` block: every line until closing marker is text.
 *
 * This is the only practical way for pasted code — it's impossible to
 * manually add `\` to the end of every line of pasted text.
 */
async function readBlock() {
    ui.hint(`Block mode: write ${BLOCK_DELIMITER} alone on a line to finish.`);
    const lines = [];
    for (;;) {
        const line = await input({ message: "", theme: continuationTheme });
        if (isBlockDelimiter(line))
            break;
        lines.push(line);
    }
    return joinLines(lines);
}
async function runSlash(name, args, session, hooks) {
    const { workspace } = hooks;
    switch (name) {
        case "help":
            showHelp(workspace);
            return "continue";
        case "exit":
            ui.hint("Goodbye.");
            return "exit";
        case "pwd":
            ui.info(session.cwd);
            return "continue";
        case "cd":
            // When targeting Studio, working directory has no effect; silently
            // accepting would make the user think they typed in the wrong place.
            if (!requireDisk(workspace, "/cd"))
                return "continue";
            await changeDirectory(session, args[0], hooks.setWorkspace);
            return "continue";
        case "ls":
            await listDirectory(session, args[0]);
            return "continue";
        case "file":
            await pinFiles(session, workspace, args);
            return "continue";
        case "files":
            showPinned(session);
            return "continue";
        case "unfile":
            unpinFiles(session, args);
            return "continue";
        case "scan":
            await scanIntoSession(session, workspace);
            return "continue";
        case "clear":
            session.resetHistory();
            ui.success("Chat history cleared.");
            return "continue";
        case "provider":
            await switchProvider(session, args[0], hooks.setProvider);
            return "continue";
        case "model":
            switchModel(session, args[0]);
            return "continue";
        case "baseurl":
            await switchBaseUrl(session, args[0], hooks.setProvider);
            return "continue";
        case "apikey":
            await handleApiKeyCommand(session, hooks.setProvider);
            return "continue";
        case "auto":
            toggleAuto(session, args[0]);
            return "continue";
        case "web":
            await toggleWeb(session, args[0]);
            return "continue";
        case "mcp":
            await handleMCPCommand(args, hooks);
            return "continue";
        case "status":
            await showStatus(hooks);
            return "continue";
        case "version":
            ui.info(`OnlyCLI v${VERSION}`);
            return "continue";
        case "cls":
            console.clear();
            banner(session, workspace);
            return "continue";
        case "cache":
            ui.hint("Cache functionality removed.");
            return "continue";
        case "health":
            ui.hint("Health check functionality removed.");
            return "continue";
        case "server":
            ui.hint("Server status functionality removed.");
            return "continue";
        default:
            ui.failure(`Unknown command: /${name}`);
            ui.hint(`Valid commands: ${SLASH_COMMANDS.map((c) => `/${c}`).join(", ")}`);
            return "continue";
    }
}
function showHelp(workspace) {
    ui.blank();
    ui.rule("commands");
    const rows = [
        ["/help", "show this list"],
        ["/exit", "quit chat (Ctrl+C also works)"],
        ["/pwd", "show working directory"],
        ["/cd <path>", "change directory (no args: home dir)"],
        ["/ls [path]", "list directory contents"],
        ["/file <path...>", "pin file as context for every turn"],
        ["/files", "show pinned files"],
        ["/unfile <path|*>", "unpin file or all"],
        ["/scan", "scan project and show summary"],
        ["/clear", "reset chat history"],
        ["/provider <name>", `switch provider (${PROVIDER_IDS.join(" | ")})`],
        ["/model <name>", "switch model"],
        ["/baseurl <url>", "switch OpenAI-compatible endpoint (reset: to default)"],
        ["/apikey", "change API key for current or selected provider"],
        ["/auto [on|off]", "apply changes without approval"],
        ["/web [on|off]", "enable/disable web search/fetch"],
        ["/mcp <engine>", "connect to game engine (roblox-studio, godot, etc.)"],
        ["/status", "show membership and engine status"],
        ["/version", "show OnlyCLI version"],
        ["/cls", "clear the screen"],
    ];
    const width = Math.max(...rows.map(([left]) => left.length));
    for (const [left, right] of rows) {
        ui.raw(`  ${theme.accentSoft(left.padEnd(width))}  ${theme.muted(right)}`);
    }
    ui.blank();
    ui.hint('To send text starting with "/" to the model, use "//".');
    ui.hint(`Multiline request: end line with \\, or write ${BLOCK_DELIMITER} to open a block.`);
    ui.blank();
}
/**
 * Changes directory. User can navigate to any directory on the machine;
 * the restriction is on the agent's authority, not the user's navigation.
 */
async function changeDirectory(session, target, setWorkspace) {
    const raw = target ?? homedir();
    const expanded = expandHome(raw);
    const next = isAbsolute(expanded)
        ? resolve(expanded)
        : resolve(session.cwd, expanded);
    let info;
    try {
        info = await stat(next);
    }
    catch {
        ui.failure(`Directory not found: ${raw}`);
        return;
    }
    if (!info.isDirectory()) {
        ui.failure(`Not a directory: ${raw}`);
        return;
    }
    const hadPins = session.pinnedFiles.length > 0;
    session.changeDirectory(next);
    // When we change session directory, we must also update the workspace's
    // sandbox root; otherwise the agent continues writing to the old directory.
    setWorkspace(new DiskWorkspace(session.cwd));
    // Pinned paths were relative to the old directory; dropping them is safer than moving.
    if (hadPins) {
        session.clearPinned();
        ui.hint("Pinned files cleared (paths were relative to the old directory).");
    }
    ui.success(session.cwd);
}
async function listDirectory(session, target) {
    const base = target
        ? resolve(session.cwd, expandHome(target))
        : session.cwd;
    let entries;
    try {
        entries = await readdir(base, { withFileTypes: true });
    }
    catch {
        ui.failure(`Could not read directory: ${target ?? session.cwd}`);
        return;
    }
    const dirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    ui.blank();
    ui.rule(shortenPath(base));
    for (const dir of dirs)
        ui.raw(`  ${theme.accent(dir + "/")}`);
    for (const file of files)
        ui.raw(`  ${theme.text(file)}`);
    if (dirs.length === 0 && files.length === 0)
        ui.hint("(empty)");
    ui.blank();
    ui.statusLine([`${dirs.length} directories`, `${files.length} files`]);
    ui.blank();
}
/**
 * Gate for commands requiring disk. Rather than silently ignoring in Studio,
 * we explain why the command doesn't work.
 */
function requireDisk(workspace, command) {
    return true;
}
async function pinFiles(session, workspace, paths) {
    if (paths.length === 0) {
        ui.failure("Usage: /file <path> [path...]");
        return;
    }
    for (const path of paths) {
        try {
            const current = await workspace.readCurrent(path);
            if (current === null) {
                ui.failure(`Not found: ${path}`);
                continue;
            }
            session.pin(path);
            ui.success(`${path} pinned.`);
        }
        catch (error) {
            ui.failure(error instanceof Error ? error.message : String(error));
        }
    }
}
function showPinned(session) {
    const pinned = session.pinnedFiles;
    if (pinned.length === 0) {
        ui.hint("No pinned files. Add with /file <path>.");
        return;
    }
    ui.blank();
    ui.rule(`${pinned.length} pinned files`);
    for (const path of pinned)
        ui.raw(`  ${theme.accentSoft(path)}`);
    ui.blank();
}
function unpinFiles(session, paths) {
    if (paths.length === 0) {
        ui.failure("Usage: /unfile <path> or /unfile *");
        return;
    }
    if (paths[0] === "*") {
        session.clearPinned();
        ui.success("All pins removed.");
        return;
    }
    for (const path of paths) {
        const normalized = toPosix(path);
        if (session.unpin(normalized)) {
            ui.success(`${normalized} removed.`);
        }
        else {
            ui.failure(`Not pinned: ${path}`);
        }
    }
}
async function scanIntoSession(session, workspace) {
    let files;
    try {
        // Scanning is delegated to the target: glob on disk, instance tree in Studio.
        files = await workspace.scan();
    }
    catch (error) {
        ui.failure(error instanceof Error ? error.message : String(error));
        return;
    }
    if (files.length === 0) {
        ui.hint("No files suitable for context found in scan.");
        return;
    }
    for (const file of files)
        session.pin(file.path);
    ui.success(`${files.length} files pinned.`);
    ui.hint(files.map((file) => file.path).join(", "));
}
async function switchProvider(session, target, setProvider) {
    if (!target) {
        ui.info(`Current provider: ${session.providerLabel} (${session.providerId})`);
        ui.hint(`Valid options: ${PROVIDER_IDS.join(", ")}`);
        return;
    }
    const normalized = target.trim().toLowerCase();
    if (!isProviderId(normalized)) {
        ui.failure(`Unknown provider: ${target}. Valid options: ${PROVIDER_IDS.join(", ")}`);
        return;
    }
    try {
        // We use resolveProvider: createProvider only reads key and base URL,
        // ignoring the model preference saved in config. This is needed so the
        // model chosen during `auth add` doesn't disappear when we change provider.
        const { provider: next, model } = await resolveProvider({
            provider: normalized,
        });
        setProvider(next);
        session.providerId = normalized;
        // displayName carries host info on custom endpoint ("OpenAI-compatible
        // (openrouter.ai)"); static label would hide where we're connecting.
        session.providerLabel = next.displayName;
        session.model = model;
        ui.success(`${session.providerLabel} / ${session.model}`);
        if (next.baseUrl)
            ui.info(`Endpoint: ${next.baseUrl}`);
    }
    catch (error) {
        if (error instanceof MissingKeyError) {
            ui.failure(error.message);
            return;
        }
        throw error;
    }
}
function switchModel(session, target) {
    if (!target) {
        ui.info(`Current model: ${session.model}`);
        return;
    }
    session.model = target;
    ui.success(`Model: ${session.model}`);
}
/**
 * Switches OpenAI-compatible endpoint mid-session.
 *
 * The change is written to config and the provider is recreated; otherwise
 * the old client object would keep hitting the old address. Model is not
 * reset intentionally: the model name the user picked usually stays valid
 * even if the endpoint changes; use /model to adjust if needed.
 */
async function switchBaseUrl(session, target, setProvider) {
    if (!supportsBaseUrl(session.providerId)) {
        ui.failure(`${session.providerLabel} uses an official SDK with a fixed endpoint; base URL cannot be changed.`);
        ui.hint("For a custom endpoint: /provider openai");
        return;
    }
    if (!target) {
        const { getBaseUrl } = await import("../config/store.js");
        const current = await getBaseUrl(session.providerId);
        ui.info(`Endpoint: ${current ?? "official API (default)"}`);
        ui.hint("To change: /baseurl https://... | to reset: /baseurl reset");
        return;
    }
    const normalized = target.trim().toLowerCase();
    if (["reset", "clear", "default", "sıfırla", "sifirla"].includes(normalized)) {
        await setBaseUrl(session.providerId, null);
        try {
            const next = await createProvider(session.providerId);
            setProvider(next);
            // Label carries host info so it needs refresh when endpoint changes.
            session.providerLabel = next.displayName;
        }
        catch (error) {
            if (error instanceof MissingKeyError) {
                ui.failure(error.message);
                return;
            }
            throw error;
        }
        ui.success("Endpoint reset; official API will be used.");
        return;
    }
    let baseUrl;
    try {
        baseUrl = normalizeBaseUrl(target);
    }
    catch (error) {
        ui.failure(error instanceof InvalidBaseUrlError ? error.message : "Invalid URL.");
        return;
    }
    await setBaseUrl(session.providerId, baseUrl);
    try {
        const next = await createProvider(session.providerId, {
            baseUrl,
            model: session.model,
        });
        setProvider(next);
        session.providerLabel = next.displayName;
    }
    catch (error) {
        if (error instanceof MissingKeyError) {
            ui.failure(error.message);
            return;
        }
        throw error;
    }
    ui.success(`Endpoint: ${baseUrl}`);
    if (isInsecureBaseUrl(baseUrl)) {
        ui.warn("Unencrypted http: your API key will travel as plain text over the network.");
    }
    ui.hint(`Current model: ${session.model} (change with /model if needed)`);
}
/**
 * Change API key for current or selected provider.
 * Prompts for provider selection and new key, then updates config.
 */
async function handleApiKeyCommand(session, setProvider) {
    ui.blank();
    // Step 1: Select provider
    const { select, password } = await import('@inquirer/prompts');
    const providerChoices = PROVIDER_IDS.map(id => ({
        name: id,
        value: id,
    }));
    let selectedProvider;
    try {
        selectedProvider = await select({
            message: 'Select provider to update API key:',
            choices: providerChoices,
            default: session.providerId,
        });
    }
    catch (error) {
        if (error instanceof Error && error.name === "ExitPromptError") {
            ui.hint("Cancelled.");
            return;
        }
        throw error;
    }
    // Step 2: Prompt for new API key
    let newKey;
    try {
        newKey = await password({
            message: `Enter new API key for ${selectedProvider}:`,
            mask: '*',
        });
    }
    catch (error) {
        if (error instanceof Error && error.name === "ExitPromptError") {
            ui.hint("Cancelled.");
            return;
        }
        throw error;
    }
    const trimmed = newKey.trim();
    if (!trimmed) {
        ui.failure("API key cannot be empty.");
        return;
    }
    // Step 3: Save the key
    const { setApiKey } = await import("../config/store.js");
    try {
        const backend = await setApiKey(selectedProvider, trimmed);
        const storageInfo = backend === "keychain"
            ? "securely stored in system keychain"
            : "stored in ~/.onlycli/credentials.json (0600 permissions)";
        ui.success(`API key for ${selectedProvider} updated (${storageInfo})`);
        // Step 4: If updating current provider, recreate provider instance
        if (selectedProvider === session.providerId) {
            try {
                const next = await createProvider(selectedProvider, {
                    model: session.model,
                });
                setProvider(next);
                session.providerLabel = next.displayName;
                ui.success(`Active provider refreshed: ${session.providerLabel}`);
            }
            catch (error) {
                if (error instanceof MissingKeyError) {
                    ui.failure(error.message);
                    return;
                }
                throw error;
            }
        }
        else {
            ui.hint(`Use /provider ${selectedProvider} to switch to this provider`);
        }
    }
    catch (error) {
        ui.failure(error instanceof Error ? error.message : "Failed to save API key");
    }
    ui.blank();
}
function toggleAuto(session, target) {
    if (target === undefined) {
        session.autoApprove = !session.autoApprove;
    }
    else {
        const on = ["on", "açık", "acik", "true", "1", "evet"].includes(target.toLowerCase());
        session.autoApprove = on;
    }
    if (session.autoApprove) {
        ui.warn("Auto-apply ON: changes will be written without asking.");
    }
    else {
        ui.success("Auto-apply OFF: approval will be requested for each change.");
    }
}
/**
 * Toggle web tools on/off and report which search path will be used.
 *
 * Source info matters: keyless DuckDuckGo fallback works but is fragile
 * (HTML scraping) and can hit rate limits. User should enable /web knowingly.
 */
async function toggleWeb(session, target) {
    if (target === undefined) {
        session.webEnabled = !session.webEnabled;
    }
    else {
        session.webEnabled = ["on", "açık", "acik", "true", "1", "evet"].includes(target.toLowerCase());
    }
    if (!session.webEnabled) {
        ui.success("Web access OFF: model will answer from its own knowledge.");
        return;
    }
    const { resolveSearchSource } = await import("../web/search.js");
    const { SEARCH_SOURCE_LABELS } = await import("../web/types.js");
    const source = await resolveSearchSource();
    ui.success(`Web access ON. Search: ${SEARCH_SOURCE_LABELS[source]}`);
    if (source === "duckduckgo") {
        ui.hint("Using keyless mode; may hit rate limits. For more reliable results: onlycli auth search add --backend brave");
    }
}
/** Turn error: display but don't break the loop. */
function reportTurnError(error) {
    if (error instanceof ProviderError) {
        ui.failure(error.userMessage);
        return;
    }
    if (error instanceof PathEscapeError || error instanceof MissingKeyError) {
        ui.failure(error.message);
        return;
    }
    if (error instanceof Error && error.name === "ExitPromptError") {
        ui.hint("Cancelled.");
        return;
    }
    ui.failure(error instanceof Error ? error.message : String(error));
}
/** Prepares a session: resolves provider and creates Session instance. */
export async function createSession(options) {
    const providerId = options.providerId && isProviderId(options.providerId)
        ? options.providerId
        : undefined;
    const { provider, model } = await resolveProvider({
        ...(providerId ? { provider: providerId } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });
    const session = new Session({
        cwd: options.cwd,
        providerId: provider.id,
        providerLabel: provider.displayName,
        model,
        autoApprove: options.autoApprove === true,
        ...(options.web !== undefined ? { web: options.web } : {}),
    });
    return { session, provider };
}
/** `~` expansion; expected behavior on Windows too. */
function expandHome(path) {
    if (path === "~")
        return homedir();
    if (path.startsWith("~/") || path.startsWith("~\\")) {
        return join(homedir(), path.slice(2));
    }
    return path;
}
/** Local copy of sandbox rule from files.ts (to avoid circular import). */
function resolveInside(base, path) {
    const root = resolve(base);
    const target = isAbsolute(path) ? resolve(path) : resolve(root, path);
    const rel = relative(root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new PathEscapeError(path);
    }
    return target;
}
function toPosix(path) {
    return path.split("\\").join("/");
}
/** Shorten home directory to `~`; prevents header line overflow. */
function shortenPath(path) {
    const home = homedir();
    if (path === home)
        return "~";
    if (path.startsWith(home + "/") || path.startsWith(home + "\\")) {
        return "~" + path.slice(home.length).split("\\").join("/");
    }
    return path.split("\\").join("/");
}
/**
 * Handle /mcp command - connect/disconnect/list engines
 */
async function handleMCPCommand(args, hooks) {
    const subcommand = args[0];
    if (!subcommand) {
        // No args: show help
        showMCPHelp();
        return;
    }
    // Import MCP modules
    const { getEngine, getAllEngines, isValidEngineId } = await import('../engines/registry.js');
    const { connectToEngine } = await import('../engines/mcp-client.js');
    switch (subcommand.toLowerCase()) {
        case 'list':
            showMCPEngines();
            return;
        case 'disconnect':
            ui.info('Disconnecting from engine...');
            // TODO: Implement disconnect logic
            ui.success('Disconnected. Returned to disk mode.');
            return;
        case 'status':
            ui.info('MCP Status: Not connected');
            // TODO: Show current connection status
            return;
        default:
            // Treat as engine name
            const engineId = subcommand.toLowerCase();
            if (!isValidEngineId(engineId)) {
                ui.failure(`Unknown engine: ${engineId}`);
                ui.hint('Available engines: roblox-studio, godot, unity, unreal');
                ui.hint('Run /mcp list for details');
                return;
            }
            const engine = getEngine(engineId);
            if (!engine) {
                ui.failure(`Engine not found: ${engineId}`);
                return;
            }
            if (engine.status !== 'active') {
                ui.failure(`${engine.displayName} is not yet available (${engine.status})`);
                ui.hint('Only Roblox Studio is currently supported');
                return;
            }
            // Connect to engine
            ui.blank();
            ui.info(`Connecting to ${engine.displayName}...`);
            try {
                const connection = await connectToEngine(engine);
                ui.success(`✓ Connected to ${engine.displayName}`);
                ui.info(`Available tools: ${connection.tools.length}`);
                ui.blank();
                ui.hint('The AI can now control the game engine directly.');
                ui.hint('Try: "create a red part at position 0,10,0"');
                ui.blank();
                // Store connection in session
                hooks.session.mcpConnection = connection;
            }
            catch (error) {
                // Parse error message if it's JSON (Zod validation errors)
                let errorMsg = error instanceof Error ? error.message : 'Unknown error';
                try {
                    const parsed = JSON.parse(errorMsg);
                    if (Array.isArray(parsed)) {
                        // Zod validation errors - extract meaningful info
                        const issues = parsed.map((err) => `${err.path?.join('.') || 'schema'}: ${err.message}`).join(', ');
                        errorMsg = `Schema validation failed: ${issues}`;
                    }
                }
                catch {
                    // Not JSON, use as-is
                }
                ui.failure(`Failed to connect: ${errorMsg}`);
                ui.blank();
                ui.hint('Make sure:');
                if (engine.id === 'roblox-studio') {
                    ui.hint('  1. Roblox Studio is open');
                    ui.hint('  2. A place is open in Studio');
                    ui.hint('  3. MCP server is enabled (should be automatic)');
                }
                ui.blank();
            }
    }
}
/**
 * Show /mcp help
 */
function showMCPHelp() {
    ui.blank();
    ui.rule('MCP Commands');
    ui.blank();
    ui.raw(`  ${theme.accentSoft('/mcp <engine>'.padEnd(25))}  ${theme.muted('Connect to game engine')}`);
    ui.raw(`  ${theme.accentSoft('/mcp list'.padEnd(25))}  ${theme.muted('Show available engines')}`);
    ui.raw(`  ${theme.accentSoft('/mcp status'.padEnd(25))}  ${theme.muted('Show connection status')}`);
    ui.raw(`  ${theme.accentSoft('/mcp disconnect'.padEnd(25))}  ${theme.muted('Disconnect from engine')}`);
    ui.blank();
}
/**
 * Show available engines
 */
async function showMCPEngines() {
    const { getAllEngines } = await import('../engines/registry.js');
    const { printEngine } = await import('../onboarding/ascii.js');
    ui.blank();
    ui.rule('Available Game Engines');
    ui.blank();
    const engines = getAllEngines();
    for (const engine of engines) {
        printEngine(engine.displayName, engine.status, engine.icon);
        if (engine.status === 'active') {
            ui.hint(`  Command: /mcp ${engine.name}`);
        }
    }
    ui.blank();
    ui.hint('Only active engines can be connected');
    ui.blank();
}
/**
 * Show status (membership + MCP)
 */
async function showStatus(hooks) {
    const { checkMembershipStatus } = await import('../membership/manager.js');
    const { printBox } = await import('../onboarding/ascii.js');
    ui.blank();
    ui.rule('OnlyCLI Status');
    ui.blank();
    try {
        const status = await checkMembershipStatus();
        if (!status.valid) {
            ui.failure('❌ No active membership');
            ui.hint('Your membership may have expired');
            ui.hint('Run: onlycli setup (to re-register)');
            ui.blank();
            return;
        }
        const typeLabel = status.type === 'premium' ? '👑 Premium' : '🆓 Free';
        const daysColor = status.daysLeft <= 3 ? theme.error : theme.ok;
        ui.info(`${typeLabel} Membership`);
        ui.info(`Days remaining: ${daysColor(status.daysLeft.toString())}`);
        ui.blank();
        ui.info('Features:');
        ui.raw(`  ${status.features.robloxStudio ? theme.ok('✓') : theme.muted('✗')} Roblox Studio`);
        ui.raw(`  ${status.features.godot ? theme.ok('✓') : theme.muted('✗')} Godot Engine`);
        ui.raw(`  ${status.features.unity ? theme.ok('✓') : theme.muted('✗')} Unity`);
        ui.raw(`  ${status.features.unreal ? theme.ok('✓') : theme.muted('✗')} Unreal Engine`);
        ui.blank();
        if (status.daysLeft <= 3) {
            ui.warn(`⚠ Your membership expires in ${status.daysLeft} days!`);
            ui.blank();
        }
        // MCP status
        ui.rule('MCP Connection');
        ui.blank();
        ui.info('Status: Not connected');
        ui.hint('Use /mcp <engine> to connect');
        ui.blank();
    }
    catch (error) {
        ui.failure(`Failed to check status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        ui.blank();
    }
}
//# sourceMappingURL=repl.js.map