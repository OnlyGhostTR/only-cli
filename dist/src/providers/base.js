/**
 * Provider-agnostic katman.
 *
 * Buradaki tipler OnlyCLI'ın çekirdek sözleşmesidir: `agent.ts` hangi
 * sağlayıcının kullanıldığını asla bilmez, yalnızca `AIProvider` ile konuşur.
 * Yeni bir sağlayıcı eklemek = bu arayüzü implemente eden bir dosya eklemek.
 */
/** Desteklenen sağlayıcı kimlikleri. Yeni provider eklendikçe genişletilir. */
export const PROVIDER_IDS = ["anthropic", "gemini", "openai"];
export function isProviderId(value) {
    return PROVIDER_IDS.includes(value);
}
/**
 * Base URL'i doğrular ve normalize eder.
 *
 * API key bu adrese gönderileceği için doğrulama gevşek bırakılamaz: yalnızca
 * http/https kabul edilir, kimlik bilgisi gömülü URL'ler (user:pass@host)
 * reddedilir — böyle bir URL log'a veya config dosyasına sızabilir.
 */
export function normalizeBaseUrl(value) {
    const trimmed = value.trim();
    if (!trimmed)
        throw new InvalidBaseUrlError(value, "boş olamaz");
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new InvalidBaseUrlError(value, "geçerli bir URL değil (örn. https://api.example.com/v1)");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new InvalidBaseUrlError(value, "yalnızca http veya https desteklenir");
    }
    if (url.username || url.password) {
        throw new InvalidBaseUrlError(value, "URL içinde kullanıcı adı/şifre taşınamaz; key'i ayrı verin");
    }
    if (url.search || url.hash) {
        throw new InvalidBaseUrlError(value, "sorgu veya fragment içeremez");
    }
    // Sondaki bölü SDK'nın yol birleştirmesini bozabiliyor; tek biçime indiriyoruz.
    const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    return normalized;
}
export class InvalidBaseUrlError extends Error {
    constructor(value, reason) {
        super(`Geçersiz base URL (${value}): ${reason}.`);
        this.name = "InvalidBaseUrlError";
    }
}
/** Base URL şifresiz taşıma kullanıyorsa true; çağıran katman kullanıcıyı uyarır. */
export function isInsecureBaseUrl(baseUrl) {
    try {
        const url = new URL(baseUrl);
        if (url.protocol !== "http:")
            return false;
        // localhost'a giden düz http trafiği makineden çıkmıyor; uyarmak gürültü olur.
        return !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
    }
    catch {
        return false;
    }
}
export class ProviderError extends Error {
    provider;
    kind;
    status;
    constructor(provider, kind, message, options) {
        super(message, options?.cause ? { cause: options.cause } : undefined);
        this.name = "ProviderError";
        this.provider = provider;
        this.kind = kind;
        this.status = options?.status;
    }
    /** Kullanıcıya gösterilecek, ne yapması gerektiğini söyleyen mesaj. */
    get userMessage() {
        switch (this.kind) {
            case "auth":
                return `${this.provider} API key'i geçersiz veya reddedildi. "onlycli auth add --provider ${this.provider}" ile yeniden ekleyin.`;
            case "rate_limit":
                return `${this.provider} hız limitine ulaşıldı. Kısa bir süre bekleyip tekrar deneyin.`;
            case "quota":
                return `${this.provider} kotanız/krediniz tükenmiş görünüyor. Sağlayıcı panelinden faturalandırmayı kontrol edin.`;
            case "not_found":
                return `Model bulunamadı: ${this.message}`;
            case "network":
                return `${this.provider} sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.`;
            case "aborted":
                return "İstek iptal edildi.";
            case "invalid_request":
                return `İstek reddedildi: ${this.message}`;
            default:
                return `${this.provider} beklenmeyen bir hata döndürdü: ${this.message}`;
        }
    }
}
/** HTTP durum kodundan hata türü çıkarır (SDK'lar arasında ortak davranış). */
export function kindFromStatus(status) {
    switch (status) {
        case 401:
        case 403:
            return "auth";
        case 404:
            return "not_found";
        case 400:
        case 422:
            return "invalid_request";
        case 429:
            return "rate_limit";
        default:
            if (status !== undefined && status >= 500)
                return "network";
            return "unknown";
    }
}
//# sourceMappingURL=base.js.map