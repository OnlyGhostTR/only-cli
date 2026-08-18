import { input, password, select } from "@inquirer/prompts";
import { baseUrlEnvVarFor, deleteApiKey, deleteSearchKey, envVarFor, getBaseUrl, listApiKeys, listSearchKeys, readConfig, searchEnvVarFor, setApiKey, setBaseUrl, setDefaultProvider, setModel, setSearchKey, writeConfig, } from "../config/store.js";
import { InvalidBaseUrlError, isInsecureBaseUrl, normalizeBaseUrl, } from "../providers/base.js";
import { isProviderId, KNOWN_ENDPOINTS, PROVIDER_IDS, PROVIDER_KEY_URLS, PROVIDER_LABELS, supportsBaseUrl, } from "../providers/index.js";
import * as ui from "../ui/components.js";
import { bold, glyph, theme } from "../ui/theme.js";
import { UsageError } from "../utils/errors.js";
import { isSearchBackendId, SEARCH_BACKENDS, SEARCH_SOURCE_LABELS, } from "../web/types.js";
export function registerAuthCommand(program) {
    const auth = program
        .command("auth")
        .description("Manage API keys (BYOK)");
    auth
        .command("add")
        .description("Add API key for a provider")
        .option("--provider <name>", `provider (${PROVIDER_IDS.join(" | ")})`)
        .option("--key <key>", "API key. If omitted, prompted as secret input (recommended to avoid shell history)")
        .option("--base-url <url>", "OpenAI-compatible custom endpoint (OpenRouter, Groq, Ollama, your proxy)")
        .option("--model <model>", "default model for this provider")
        .action(async (options) => {
        const provider = await resolveProviderArg(options.provider);
        // Resolve endpoint before key: key must be entered knowing which service
        // it will go to, since the key will be sent directly to that address.
        const endpoint = await resolveEndpoint(provider, options);
        let apiKey = options.key?.trim();
        if (!apiKey) {
            if (!endpoint.baseUrl) {
                ui.hint(`Get key at: ${PROVIDER_KEY_URLS[provider]}`);
            }
            apiKey = await password({
                message: endpoint.baseUrl
                    ? `API key (${hostOf(endpoint.baseUrl)}):`
                    : `${PROVIDER_LABELS[provider]} API key:`,
                mask: true,
                validate: (value) => value.trim().length > 0 ? true : "Key cannot be empty.",
            });
        }
        else {
            ui.warn("Value passed with --key may be recorded in shell history. Omit --key for secret input (recommended).");
        }
        const backend = await setApiKey(provider, apiKey);
        if (supportsBaseUrl(provider)) {
            await setBaseUrl(provider, endpoint.baseUrl ?? null);
            if (endpoint.model)
                await setModel(provider, endpoint.model);
        }
        const config = await readConfig();
        if (!config.defaultProvider) {
            await setDefaultProvider(provider);
            ui.hint(`Default provider set to ${provider}.`);
        }
        else if (config.defaultProvider !== provider) {
            // Adding a key does not silently change the default; user should
            // understand why the newly added provider isn't being used.
            ui.hint(`Default provider is still ${config.defaultProvider}. To use this one:`);
            ui.hint(`  onlycli auth default --provider ${provider}`);
            ui.hint(`  or in chat: /provider ${provider}`);
        }
        if (backend === "keychain") {
            ui.success(`${PROVIDER_LABELS[provider]} key saved to OS keychain.`);
        }
        else {
            ui.success(`${PROVIDER_LABELS[provider]} key saved.`);
            ui.warn("OS keychain not accessible.");
            ui.hint("Key is kept as plain text in ~/.onlycli/credentials.json with");
            ui.hint("permissions readable only by your user (0600).");
            ui.hint(`For stronger protection, use the ${envVarFor(provider)} environment variable.`);
        }
        if (endpoint.baseUrl) {
            ui.info(`Endpoint: ${endpoint.baseUrl}`);
            if (endpoint.model)
                ui.info(`Model: ${endpoint.model}`);
            if (isInsecureBaseUrl(endpoint.baseUrl)) {
                // Plain http carries the key in readable form on the network;
                // this cannot pass silently.
                ui.warn("This endpoint uses insecure http: your API key will be sent as plain text over the network.");
                ui.hint("Use https for non-local services.");
            }
        }
    });
    auth
        .command("endpoint")
        .description("Set or display OpenAI-compatible endpoint")
        .option("--provider <name>", `provider (${PROVIDER_IDS.join(" | ")})`)
        .option("--base-url <url>", "new base URL")
        .option("--model <model>", "default model for this endpoint")
        .option("--reset", "remove custom endpoint and use official API")
        .action(async (options) => {
        const provider = await resolveProviderArg(options.provider);
        if (!supportsBaseUrl(provider)) {
            throw new UsageError(`${PROVIDER_LABELS[provider]} uses official SDK with fixed endpoint; cannot change base URL. Use --provider openai for custom endpoints.`);
        }
        if (options.reset) {
            await setBaseUrl(provider, null);
            ui.success("Custom endpoint removed; official API will be used.");
            return;
        }
        if (!options.baseUrl && !options.model) {
            const current = await getBaseUrl(provider);
            const config = await readConfig();
            ui.info(`Endpoint: ${current ?? "official API (default)"}`);
            ui.info(`Model: ${config.models?.[provider] ?? "(provider default)"}`);
            ui.hint(`To temporarily override via environment variable: ${baseUrlEnvVarFor(provider)}`);
            return;
        }
        if (options.baseUrl) {
            const normalized = parseBaseUrl(options.baseUrl);
            await setBaseUrl(provider, normalized);
            ui.success(`Endpoint: ${normalized}`);
            if (isInsecureBaseUrl(normalized)) {
                ui.warn("Insecure http: your API key will be sent as plain text over the network.");
            }
        }
        if (options.model) {
            await setModel(provider, options.model.trim());
            ui.success(`Model: ${options.model.trim()}`);
        }
    });
    auth
        .command("list")
        .description("List registered keys (masked)")
        .action(async () => {
        const keys = await listApiKeys(PROVIDER_IDS);
        const config = await readConfig();
        if (keys.length === 0) {
            ui.hint("No registered API keys.");
            ui.hint("To add: onlycli auth add --provider anthropic");
            return;
        }
        ui.header("registered keys");
        ui.rule();
        for (const entry of keys) {
            const isDefault = config.defaultProvider === entry.provider;
            // Default provider is marked at line start with a symbol; text label
            // is also included so color alone is not the only distinguishing feature.
            const marker = isDefault
                ? theme.accent(glyph.diamond)
                : theme.frame(glyph.dot);
            const name = isDefault
                ? bold(theme.accent(entry.provider.padEnd(10)))
                : theme.text(entry.provider.padEnd(10));
            const suffix = isDefault ? theme.accentDeep(" default") : "";
            ui.raw(`${marker} ${name} ${theme.muted(entry.masked.padEnd(16))} ${theme.frame(backendLabel(entry.backend))}${suffix}`);
        }
    });
    auth
        .command("remove")
        .description("Delete API key for a provider")
        .option("--provider <name>", `provider (${PROVIDER_IDS.join(" | ")})`)
        .action(async (options) => {
        const provider = await resolveProviderArg(options.provider);
        const removed = await deleteApiKey(provider);
        if (!removed) {
            ui.hint(`No registered key found for ${provider}.`);
            return;
        }
        const config = await readConfig();
        if (config.defaultProvider === provider) {
            delete config.defaultProvider;
            await writeConfig(config);
        }
        ui.success(`${provider} key deleted.`);
        if (process.env[envVarFor(provider)]) {
            ui.warn(`${envVarFor(provider)} environment variable is still defined and will continue to be used.`);
        }
    });
    auth
        .command("default")
        .description("Set default provider")
        .option("--provider <name>", `provider (${PROVIDER_IDS.join(" | ")})`)
        .action(async (options) => {
        const provider = await resolveProviderArg(options.provider);
        await setDefaultProvider(provider);
        ui.success(`Default provider: ${provider}`);
    });
    registerSearchKeyCommands(auth);
}
/**
 * Search keys are kept in a separate namespace from AI provider keys:
 * they are different services and storing them together confused users
 * in the `auth list` output. The key is optional — the DuckDuckGo path
 * without a key always works.
 */
function registerSearchKeyCommands(auth) {
    const search = auth
        .command("search")
        .description("Manage web search provider keys (optional)");
    search
        .command("add")
        .description("Add API key for a search provider")
        .option("--backend <name>", `search provider (${SEARCH_BACKENDS.join(" | ")})`)
        .option("--key <key>", "API key. If omitted, prompted as secret input (recommended to avoid shell history)")
        .action(async (options) => {
        const backend = await resolveSearchBackendArg(options.backend);
        const apiKey = options.key
            ? options.key.trim()
            : (await password({
                message: `${SEARCH_SOURCE_LABELS[backend]} API key:`,
                mask: true,
            })).trim();
        if (apiKey === "")
            throw new UsageError("API key cannot be empty.");
        const storage = await setSearchKey(backend, apiKey);
        ui.success(`${SEARCH_SOURCE_LABELS[backend]} key saved (${backendLabel(storage)}).`);
        ui.hint("To enable web access in chat: /web on");
    });
    search
        .command("list")
        .description("List registered search keys (masked)")
        .action(async () => {
        const keys = await listSearchKeys();
        if (keys.length === 0) {
            ui.hint("No registered search keys.");
            ui.hint("DuckDuckGo path without key will be used. For better results: onlycli auth search add --backend brave");
            return;
        }
        ui.header("search keys");
        ui.rule();
        for (const entry of keys) {
            ui.raw(`${theme.frame(glyph.dot)} ${theme.text(entry.backend.padEnd(10))} ${theme.muted(entry.masked.padEnd(16))} ${theme.frame(backendLabel(entry.storage))}`);
        }
    });
    search
        .command("remove")
        .description("Delete search key for a provider")
        .option("--backend <name>", `search provider (${SEARCH_BACKENDS.join(" | ")})`)
        .action(async (options) => {
        const backend = await resolveSearchBackendArg(options.backend);
        const removed = await deleteSearchKey(backend);
        if (!removed) {
            ui.hint(`No registered key found for ${backend}.`);
            return;
        }
        ui.success(`${backend} key deleted.`);
        if (process.env[searchEnvVarFor(backend)]) {
            ui.warn(`${searchEnvVarFor(backend)} environment variable is still defined and will continue to be used.`);
        }
    });
}
/** Prompts for interactive selection if `--backend` is not provided. */
async function resolveSearchBackendArg(value) {
    if (value) {
        const normalized = value.trim().toLowerCase();
        if (!isSearchBackendId(normalized)) {
            throw new UsageError(`Unknown search provider: ${value}. Valid values: ${SEARCH_BACKENDS.join(", ")}`);
        }
        return normalized;
    }
    if (!process.stdin.isTTY) {
        throw new UsageError(`--backend must be specified (${SEARCH_BACKENDS.join(" | ")}).`);
    }
    return select({
        message: "Choose search provider:",
        choices: SEARCH_BACKENDS.map((id) => ({
            name: SEARCH_SOURCE_LABELS[id],
            value: id,
        })),
    });
}
function backendLabel(backend) {
    switch (backend) {
        case "keychain":
            return "OS keychain";
        case "file":
            return "~/.onlycli/credentials.json";
        case "env":
            return "environment variable";
    }
}
/** Prompts for interactive selection if `--provider` is not provided. */
async function resolveProviderArg(value) {
    if (value) {
        const normalized = value.trim().toLowerCase();
        if (!isProviderId(normalized)) {
            throw new UsageError(`Unknown provider: ${value}. Valid values: ${PROVIDER_IDS.join(", ")}`);
        }
        return normalized;
    }
    if (!process.stdin.isTTY) {
        throw new UsageError(`--provider must be specified (${PROVIDER_IDS.join(" | ")}).`);
    }
    return select({
        message: "Choose provider:",
        choices: PROVIDER_IDS.map((id) => ({
            name: PROVIDER_LABELS[id],
            value: id,
        })),
    });
}
/**
 * Determines which endpoint to use.
 *
 * If a flag is provided, uses it directly. If not and the terminal is
 * interactive, offers a selection from a list of known services — the user
 * shouldn't have to recall the correct base URL from memory.
 */
async function resolveEndpoint(provider, options) {
    if (!supportsBaseUrl(provider)) {
        if (options.baseUrl) {
            throw new UsageError(`--base-url not supported for ${PROVIDER_LABELS[provider]}; official SDK uses fixed endpoint. Use --provider openai for custom endpoints.`);
        }
        return {};
    }
    if (options.baseUrl) {
        return {
            baseUrl: parseBaseUrl(options.baseUrl),
            ...(options.model ? { model: options.model.trim() } : {}),
        };
    }
    // Prompting in non-interactive mode locks the command; silently fall back
    // to official API.
    if (!process.stdin.isTTY) {
        return options.model ? { model: options.model.trim() } : {};
    }
    const choice = await select({
        message: "Endpoint:",
        choices: [
            ...KNOWN_ENDPOINTS.map((endpoint) => ({
                name: endpoint.baseUrl
                    ? `${endpoint.label} ${theme.muted(endpoint.baseUrl)}`
                    : endpoint.label,
                value: endpoint.baseUrl,
            })),
            { name: "Other (enter base URL)", value: "__custom__" },
        ],
    });
    let baseUrl;
    if (choice === "__custom__") {
        const entered = await input({
            message: "Base URL:",
            validate: (value) => {
                try {
                    normalizeBaseUrl(value);
                    return true;
                }
                catch (error) {
                    return error instanceof InvalidBaseUrlError
                        ? error.message
                        : "Invalid URL.";
                }
            },
        });
        baseUrl = normalizeBaseUrl(entered);
    }
    else if (choice) {
        baseUrl = normalizeBaseUrl(choice);
    }
    let model = options.model?.trim();
    if (baseUrl && !model) {
        // Model names differ between compatible services; trusting the default
        // produces 404, so we ask here.
        const suggestion = KNOWN_ENDPOINTS.find((endpoint) => endpoint.baseUrl === baseUrl)?.exampleModel;
        const entered = await input({
            message: suggestion ? `Model (e.g. ${suggestion}):` : "Model:",
            ...(suggestion ? { default: suggestion } : {}),
        });
        model = entered.trim() || undefined;
    }
    return {
        ...(baseUrl ? { baseUrl } : {}),
        ...(model ? { model } : {}),
    };
}
/** Validates base URL; converts error to user language. */
function parseBaseUrl(value) {
    try {
        return normalizeBaseUrl(value);
    }
    catch (error) {
        if (error instanceof InvalidBaseUrlError) {
            throw new UsageError(error.message);
        }
        throw error;
    }
}
function hostOf(baseUrl) {
    try {
        return new URL(baseUrl).host;
    }
    catch {
        return baseUrl;
    }
}
//# sourceMappingURL=auth.js.map