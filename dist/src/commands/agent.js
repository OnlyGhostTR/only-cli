import { createSession, runRepl } from "../agent/repl.js";
import { runTurn } from "../agent/turn.js";
import { InvalidBaseUrlError, isInsecureBaseUrl, normalizeBaseUrl, } from "../providers/base.js";
import { isProviderId, PROVIDER_IDS, supportsBaseUrl, } from "../providers/index.js";
import * as ui from "../ui/components.js";
import { theme } from "../ui/theme.js";
import { UsageError } from "../utils/errors.js";
import { isSensitivePath } from "../utils/files.js";
/** Base URL flag repeated in both `agent` and `chat` commands. */
const BASE_URL_FLAG = [
    "--base-url <url>",
    "Override OpenAI-compatible endpoint for this run only (not saved)",
];
/**
 * Web tools on by default; we offer the disable flag.
 *
 * Users might want to disable for a reason (offline environment, corporate
 * network rules, don't want agent to read external content); they should be
 * able to do it with a single flag per run.
 */
const NO_WEB_FLAG = [
    "--no-web",
    "Disable web search and page fetching",
];
export function registerAgentCommand(program) {
    program
        .command("agent")
        .description("Send a single request to AI agent (for chat: onlycli chat)")
        /*
         * Variable arguments: typing `onlycli agent add a tree` unquoted is the
         * most common use, but single-value `<prompt>` would only capture the
         * first word and silently drop the rest — user would see a strange model
         * response and have to figure out the request got truncated. Joining parts
         * with space makes both quoted and unquoted calls work.
         */
        .argument("<prompt...>", "request to send to agent")
        .option("--provider <name>", `provider (${PROVIDER_IDS.join(" | ")})`)
        .option("--model <model>", "model ID to use")
        .option("-f, --file <path>", "add file to context (can be used multiple times)", collect, [])
        .option("--image <path>", "attach image file (PNG, JPG, etc)")
        .option("--clipboard", "attach image from Windows clipboard")
        .option(...BASE_URL_FLAG)
        .option("--scan", "auto-scan working directory and add to context")
        .option("--yes", "apply suggested file changes without asking (use carefully)")
        .option(...NO_WEB_FLAG)
        .option("--max-tokens <n>", "upper token limit for response")
        .action(async (parts, options) => {
        await runOnce(joinPrompt(parts), options);
    });
}
/** Interactive chat: `onlycli chat` and unargued `onlycli`. */
export function registerChatCommand(program) {
    program
        .command("chat", { isDefault: true })
        .description("start interactive chat (default command)")
        .option("--provider <name>", `provider (${PROVIDER_IDS.join(" | ")})`)
        .option("--model <model>", "model ID to use")
        .option("-f, --file <path>", "pin file to context at startup", collect, [])
        .option(...BASE_URL_FLAG)
        .option("--scan", "scan directory and pin files at startup")
        .option("--image <path>", "attach image file (PNG, JPG, etc)")
        .option("--clipboard", "attach image from Windows clipboard")
        .option("--yes", "apply file changes without asking")
        .option(...NO_WEB_FLAG)
        .option("--max-tokens <n>", "upper token limit for response")
        .action(async (options) => {
        await runChat(options);
    });
}
async function runChat(options) {
    if (!process.stdin.isTTY) {
        throw new UsageError('Chat requires an interactive terminal. For a single request in a pipe: onlycli agent "<request>"');
    }
    const providerId = normalizeProvider(options.provider);
    const maxTokens = parseMaxTokens(options.maxTokens);
    const baseUrl = resolveCliBaseUrl(options.baseUrl, providerId);
    const { session, provider } = await createSession({
        cwd: process.cwd(),
        ...(providerId ? { providerId } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        autoApprove: options.yes === true,
        web: options.web !== false,
    });
    for (const path of options.file ?? []) {
        if (isSensitivePath(path)) {
            ui.warn(`${path} not pinned: may contain secrets.`);
            continue;
        }
        session.pin(path);
    }
    if (options.scan) {
        const { scanProject } = await import("../utils/files.js");
        for (const file of await scanProject(session.cwd)) {
            session.pin(file.relativePath);
        }
    }
    await runRepl({
        session,
        provider,
        ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
}
async function runOnce(prompt, options) {
    const providerId = normalizeProvider(options.provider);
    const maxTokens = parseMaxTokens(options.maxTokens);
    const baseUrl = resolveCliBaseUrl(options.baseUrl, providerId);
    const files = options.file ?? [];
    for (const path of files) {
        if (isSensitivePath(path)) {
            throw new UsageError(`${path} may contain secrets; won't be added to context. If really needed, paste its content manually into the prompt.`);
        }
    }
    const { session, provider } = await createSession({
        cwd: process.cwd(),
        ...(providerId ? { providerId } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(baseUrl ? { baseUrl } : {}),
        autoApprove: options.yes === true,
        web: options.web !== false,
    });
    ui.header(`${provider.displayName} ${theme.frame("/")} ${session.model}`);
    ui.rule();
    await runTurn({
        provider,
        session,
        prompt,
        files,
        scan: options.scan === true,
        ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
}
function normalizeProvider(value) {
    if (!value)
        return undefined;
    const normalized = value.trim().toLowerCase();
    if (!isProviderId(normalized)) {
        throw new UsageError(`Unknown provider: ${value}. Valid values: ${PROVIDER_IDS.join(", ")}`);
    }
    return normalized;
}
function collect(value, previous) {
    return [...previous, value];
}
/**
 * Join variable arguments into a single request.
 *
 * Shell splits unquoted input by spaces and absorbs consecutive spaces;
 * joining parts with a single space produces the closest result to the
 * original. In quoted calls, a single part arrives with the user's spacing
 * preserved.
 */
export function joinPrompt(parts) {
    const prompt = parts.join(" ").trim();
    /*
     * Commander requires at least one argument for `<prompt...>`, but that
     * argument can be empty or whitespace-only (`onlycli agent ""`). Sending
     * an empty request to the provider is a wasted call and produces a
     * meaningless error message; we catch it here.
     */
    if (!prompt) {
        throw new UsageError('Request is empty. Example: onlycli agent "find the bug in this function"');
    }
    return prompt;
}
/**
 * Validate `--base-url` value.
 *
 * This value is not saved; it's only for this run. If provider isn't
 * specified, we can't check capabilities, so we defer validation to
 * createProvider — base URL is already ignored there for unsupported
 * providers anyway.
 */
function resolveCliBaseUrl(value, providerId) {
    if (!value)
        return undefined;
    if (providerId && isProviderId(providerId) && !supportsBaseUrl(providerId)) {
        throw new UsageError(`--base-url not valid for ${providerId}; official SDK uses fixed endpoint. Use --provider openai for custom endpoints.`);
    }
    let normalized;
    try {
        normalized = normalizeBaseUrl(value);
    }
    catch (error) {
        throw error instanceof InvalidBaseUrlError
            ? new UsageError(error.message)
            : error;
    }
    if (isInsecureBaseUrl(normalized)) {
        ui.warn("Insecure http endpoint: your API key will travel as plain text over the network.");
    }
    return normalized;
}
function parseMaxTokens(value) {
    if (value === undefined)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new UsageError("--max-tokens must be a positive integer.");
    }
    return parsed;
}
//# sourceMappingURL=agent.js.map