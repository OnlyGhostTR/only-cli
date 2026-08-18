import { getApiKey, getBaseUrl, readConfig } from "../config/store.js";
import { AnthropicProvider } from "./anthropic.js";
import { isProviderId, normalizeBaseUrl, PROVIDER_IDS, } from "./base.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";
export { PROVIDER_IDS, isProviderId };
/** Kullanıcıya gösterilecek adlar; provider örneği oluşturmadan erişilebilir. */
export const PROVIDER_LABELS = {
    anthropic: "Anthropic Claude",
    gemini: "Google Gemini",
    openai: "OpenAI / uyumlu",
};
/** API key alma bağlantıları — auth komutunda yönlendirme için. */
export const PROVIDER_KEY_URLS = {
    anthropic: "https://console.anthropic.com/settings/keys",
    gemini: "https://aistudio.google.com/apikey",
    openai: "https://platform.openai.com/api-keys",
};
/**
 * Base URL'i özelleştirilebilen sağlayıcılar.
 *
 * Anthropic ve Gemini resmi SDK'larıyla sabit uç noktaya bağlanıyor; oraya
 * base URL kabul etmek çalışmayan bir ayar sunmak olurdu. OpenAI şeması ise
 * fiilen ortak bir standart olduğu için özel uç nokta orada anlamlı.
 */
export const BASE_URL_CAPABLE = ["openai"];
export function supportsBaseUrl(provider) {
    return BASE_URL_CAPABLE.includes(provider);
}
/** Yaygın OpenAI uyumlu servisler; auth akışında hazır seçenek olarak sunulur. */
export const KNOWN_ENDPOINTS = [
    {
        label: "OpenAI (resmi)",
        baseUrl: "",
        exampleModel: "gpt-5",
    },
    {
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        exampleModel: "anthropic/claude-sonnet-4.5",
    },
    {
        label: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        exampleModel: "llama-3.3-70b-versatile",
    },
    {
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        exampleModel: "deepseek-chat",
    },
    {
        label: "Together AI",
        baseUrl: "https://api.together.xyz/v1",
        exampleModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    },
    {
        label: "Ollama (yerel)",
        baseUrl: "http://localhost:11434/v1",
        exampleModel: "llama3.2",
    },
];
export class MissingKeyError extends Error {
    provider;
    constructor(provider) {
        super(`${PROVIDER_LABELS[provider]} için API key bulunamadı. "onlycli auth add --provider ${provider}" ile ekleyin.`);
        this.name = "MissingKeyError";
        this.provider = provider;
    }
}
export class NoDefaultProviderError extends Error {
    constructor() {
        super(`Varsayılan sağlayıcı ayarlanmamış ve kayıtlı key yok. Önce "onlycli auth add --provider <${PROVIDER_IDS.join("|")}>" çalıştırın.`);
        this.name = "NoDefaultProviderError";
    }
}
function instantiate(provider, options) {
    switch (provider) {
        case "anthropic":
            return new AnthropicProvider(options.apiKey);
        case "gemini":
            return new GeminiProvider(options.apiKey);
        case "openai":
            return new OpenAIProvider({
                apiKey: options.apiKey,
                ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
                ...(options.model ? { model: options.model } : {}),
            });
    }
}
/**
 * Belirtilen sağlayıcıyı, saklanan key ve base URL ile hazır hâlde döndürür.
 *
 * `overrides.baseUrl` CLI'dan gelen `--base-url` içindir ve kaydedilmiş
 * değerin önüne geçer; oturum içinde kalıcı olmayan deneme yapmayı sağlar.
 */
export async function createProvider(provider, overrides) {
    const apiKey = await getApiKey(provider);
    if (!apiKey)
        throw new MissingKeyError(provider);
    let baseUrl;
    if (supportsBaseUrl(provider)) {
        const raw = overrides?.baseUrl ?? (await getBaseUrl(provider));
        // Config dosyası elle düzenlenmiş olabilir; her yolda doğrula.
        if (raw)
            baseUrl = normalizeBaseUrl(raw);
    }
    return instantiate(provider, {
        apiKey,
        ...(baseUrl ? { baseUrl } : {}),
        ...(overrides?.model ? { model: overrides.model } : {}),
    });
}
/**
 * Hangi sağlayıcının kullanılacağına karar verir:
 * açık `--provider` > config'teki `defaultProvider` > key'i olan tek sağlayıcı.
 */
export async function resolveProvider(options) {
    const config = await readConfig();
    let id = options?.provider ?? config.defaultProvider;
    if (!id) {
        const available = [];
        for (const candidate of PROVIDER_IDS) {
            if (await getApiKey(candidate))
                available.push(candidate);
        }
        if (available.length === 0)
            throw new NoDefaultProviderError();
        // Tek key varsa onu seç; birden fazlaysa deterministik olmak için ilki.
        id = available[0];
    }
    const resolvedId = id;
    const model = options?.model ?? config.models?.[resolvedId] ?? undefined;
    const provider = await createProvider(resolvedId, {
        ...(options?.baseUrl ? { baseUrl: options.baseUrl } : {}),
        ...(model ? { model } : {}),
    });
    return { provider, model: model ?? provider.defaultModel };
}
//# sourceMappingURL=index.js.map