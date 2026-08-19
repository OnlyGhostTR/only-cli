import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isProviderId } from "../providers/base.js";
import { SEARCH_BACKENDS } from "../web/types.js";
const SERVICE_NAME = "onlycli";
export const CONFIG_DIR = join(homedir(), ".onlycli");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const FALLBACK_FILE = join(CONFIG_DIR, "credentials.json");
// ---------------------------------------------------------------------------
// Genel (gizli olmayan) ayarlar
// ---------------------------------------------------------------------------
export async function readConfig() {
    try {
        const raw = await readFile(CONFIG_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null)
            return {};
        const record = parsed;
        const config = {};
        const provider = record["defaultProvider"];
        if (typeof provider === "string" && isProviderId(provider)) {
            config.defaultProvider = provider;
        }
        const models = record["models"];
        if (typeof models === "object" && models !== null) {
            const result = {};
            for (const [key, value] of Object.entries(models)) {
                if (isProviderId(key) && typeof value === "string")
                    result[key] = value;
            }
            config.models = result;
        }
        const baseUrls = record["baseUrls"];
        if (typeof baseUrls === "object" && baseUrls !== null) {
            const result = {};
            for (const [key, value] of Object.entries(baseUrls)) {
                if (isProviderId(key) && typeof value === "string")
                    result[key] = value;
            }
            config.baseUrls = result;
        }
        const preferences = record["preferences"];
        if (typeof preferences === "object" && preferences !== null) {
            const result = {};
            const raw = preferences;
            // Yalnızca boolean kabul ediliyor: elle düzenlenmiş dosyadaki "true"
            // gibi bir metin, truthy olduğu için sessizce açık davranışa yol açardı.
            if (typeof raw["autoApprove"] === "boolean") {
                result.autoApprove = raw["autoApprove"];
            }
            if (typeof raw["web"] === "boolean")
                result.web = raw["web"];
            if (Object.keys(result).length > 0)
                config.preferences = result;
        }
        return config;
    }
    catch (error) {
        if (isNotFound(error))
            return {};
        // Bozuk config kullanıcıyı kilitlememeli; varsayılana düşüyoruz.
        return {};
    }
}
export async function writeConfig(config) {
    await ensureConfigDir();
    await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
}
export async function setDefaultProvider(provider) {
    const config = await readConfig();
    config.defaultProvider = provider;
    await writeConfig(config);
}
/** Base URL'i kalıcı hâle getirir; `null` verilirse kaydı siler. */
export async function setBaseUrl(provider, baseUrl) {
    const config = await readConfig();
    const baseUrls = { ...config.baseUrls };
    if (baseUrl === null) {
        delete baseUrls[provider];
    }
    else {
        baseUrls[provider] = baseUrl;
    }
    if (Object.keys(baseUrls).length === 0) {
        delete config.baseUrls;
    }
    else {
        config.baseUrls = baseUrls;
    }
    await writeConfig(config);
}
/** Model tercihini kalıcı hâle getirir; `null` verilirse kaydı siler. */
export async function setModel(provider, model) {
    const config = await readConfig();
    const models = { ...config.models };
    if (model === null) {
        delete models[provider];
    }
    else {
        models[provider] = model;
    }
    if (Object.keys(models).length === 0) {
        delete config.models;
    }
    else {
        config.models = models;
    }
    await writeConfig(config);
}
/**
 * Base URL çözümü: ortam değişkeni > config.
 *
 * Ortam değişkeninin öncelikli olması CI ve kapsayıcı senaryolarında config
 * dosyası olmadan uç nokta değiştirmeyi mümkün kılıyor.
 */
export async function getBaseUrl(provider) {
    const envUrl = process.env[baseUrlEnvVarFor(provider)];
    if (envUrl && envUrl.trim())
        return envUrl.trim();
    const config = await readConfig();
    return config.baseUrls?.[provider];
}
// ---------------------------------------------------------------------------
// Oturum tercihleri (/auto, /web)
//
// Tercihler cihazda kalır: sunucuya gönderilmez, üyelik kaydına yazılmaz.
// Aynı dosyada (config.json) tutuluyorlar çünkü gizli değil, davranış ayarı.
// ---------------------------------------------------------------------------
/** Kayıtlı tercihler. Hiç yazılmamışsa boş nesne döner. */
export async function readPreferences() {
    return (await readConfig()).preferences ?? {};
}
/**
 * Verilen tercihleri günceller; belirtilmeyen alanlar korunur.
 *
 * `null` bir alanı "seçilmemiş" hâline döndürür; böylece kullanıcı kaydı
 * silip varsayılana dönebilir.
 */
export async function setPreferences(patch) {
    const config = await readConfig();
    const preferences = { ...config.preferences };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined)
            continue;
        if (value === null) {
            delete preferences[key];
        }
        else {
            preferences[key] = value;
        }
    }
    if (Object.keys(preferences).length === 0) {
        delete config.preferences;
    }
    else {
        config.preferences = preferences;
    }
    await writeConfig(config);
}
// ---------------------------------------------------------------------------
// API key saklama
// ---------------------------------------------------------------------------
/**
 * Key'i öncelikle OS anahtar zincirine (Windows Credential Manager, macOS
 * Keychain, Linux Secret Service) yazar.
 *
 * Keychain kullanılamıyorsa `~/.onlycli/credentials.json` dosyasına 0600
 * izinle düşer. Bu dosya ŞİFRELİ DEĞİLDİR: şifreleme anahtarını da aynı
 * makinede saklamak zorunda olduğumuz için "şifreli" demek yanıltıcı olurdu.
 * Koruma dosya izinlerine dayanır ve çağıran katman kullanıcıyı uyarır.
 */
export async function setApiKey(provider, apiKey) {
    return setSecret(provider, apiKey);
}
export async function getApiKey(provider) {
    return getSecret(provider, envVarFor(provider));
}
export async function deleteApiKey(provider) {
    return deleteSecret(provider);
}
/**
 * Check if any API key is configured
 */
export async function hasApiKey() {
    const { PROVIDER_IDS } = await import('../providers/index.js');
    for (const provider of PROVIDER_IDS) {
        const key = await getApiKey(provider);
        if (key)
            return true;
    }
    return false;
}
// ---------------------------------------------------------------------------
// Arama anahtarı saklama
//
// Model anahtarlarıyla aynı mekanizmayı kullanır, farklı bir hesap ad alanında:
// `search:brave` gibi. Ad alanını ayırmak, bir gün "brave" adlı bir model
// sağlayıcısı eklenirse çakışma olmamasını sağlıyor.
// ---------------------------------------------------------------------------
function searchAccount(backend) {
    return `search:${backend}`;
}
/** Arama backend'i için tanınan ortam değişkeni adı. */
export function searchEnvVarFor(backend) {
    switch (backend) {
        case "brave":
            return "BRAVE_SEARCH_API_KEY";
        case "tavily":
            return "TAVILY_API_KEY";
    }
}
export async function setSearchKey(backend, apiKey) {
    return setSecret(searchAccount(backend), apiKey);
}
export async function getSearchKey(backend) {
    return getSecret(searchAccount(backend), searchEnvVarFor(backend));
}
export async function deleteSearchKey(backend) {
    return deleteSecret(searchAccount(backend));
}
export async function listSearchKeys() {
    const results = [];
    for (const backend of SEARCH_BACKENDS) {
        const found = await locateSecret(searchAccount(backend), searchEnvVarFor(backend));
        if (found) {
            results.push({
                backend,
                storage: found.storage,
                masked: maskKey(found.value),
            });
        }
    }
    return results;
}
export async function listApiKeys(providers) {
    const results = [];
    for (const provider of providers) {
        const found = await locateSecret(provider, envVarFor(provider));
        if (found) {
            results.push({
                provider,
                backend: found.storage,
                masked: maskKey(found.value),
            });
        }
    }
    return results;
}
/** `sk-ant-...4f9a` biçiminde, log'a düşse bile işe yaramayan bir gösterim. */
export function maskKey(key) {
    if (key.length <= 8)
        return "*".repeat(key.length);
    return `${key.slice(0, 4)}${"*".repeat(6)}${key.slice(-4)}`;
}
/** Provider için tanınan ortam değişkeni adı. */
export function envVarFor(provider) {
    switch (provider) {
        case "anthropic":
            return "ANTHROPIC_API_KEY";
        case "gemini":
            return "GEMINI_API_KEY";
        case "openai":
            return "OPENAI_API_KEY";
    }
}
/** Base URL için tanınan ortam değişkeni adı. */
export function baseUrlEnvVarFor(provider) {
    switch (provider) {
        case "anthropic":
            return "ANTHROPIC_BASE_URL";
        case "gemini":
            return "GEMINI_BASE_URL";
        case "openai":
            // OpenAI SDK'sının kendi sözleşmesiyle aynı ad; mevcut alışkanlığı bozmuyor.
            return "OPENAI_BASE_URL";
    }
}
let keyringPromise;
/**
 * `@napi-rs/keyring` optionalDependency; native binary indirilemediği
 * platformlarda yüklenmemiş olabilir. Bu yüzden dinamik ve tek seferlik.
 */
async function loadKeyring() {
    if (!keyringPromise) {
        keyringPromise = import("@napi-rs/keyring")
            .then((mod) => mod)
            .catch(() => null);
    }
    return keyringPromise;
}
async function ensureConfigDir() {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
}
/**
 * Gizli değer saklamanın tek uygulaması. Model anahtarları ve arama
 * anahtarları yalnızca "account" adıyla ayrışır; mekanizma aynı olduğu için
 * iki kopya tutmak yerine buradan geçiyorlar.
 */
async function setSecret(account, value) {
    const trimmed = value.trim();
    if (!trimmed)
        throw new Error("API key boş olamaz.");
    const keyring = await loadKeyring();
    if (keyring) {
        try {
            new keyring.Entry(SERVICE_NAME, account).setPassword(trimmed);
            // Aynı key daha önce dosyaya düşmüşse artık gereksiz; temizle.
            await removeFromFallback(account);
            return "keychain";
        }
        catch {
            // Keychain erişilemedi (ör. headless Linux, kilitli cüzdan) -> dosyaya düş.
        }
    }
    const store = await readFallback();
    store[account] = trimmed;
    await writeFallback(store);
    return "file";
}
async function getSecret(account, envVar) {
    return (await locateSecret(account, envVar))?.value ?? null;
}
async function deleteSecret(account) {
    let removed = false;
    const keyring = await loadKeyring();
    if (keyring) {
        try {
            removed = new keyring.Entry(SERVICE_NAME, account).deletePassword();
        }
        catch {
            // yok sayılır
        }
    }
    if (await removeFromFallback(account))
        removed = true;
    return removed;
}
/**
 * Değeri ve nereden geldiğini birlikte döndürür.
 *
 * Öncelik: ortam değişkeni > keychain > dosya. Listeleme komutları da bu
 * fonksiyonu kullanıyor; böylece "okuma" ile "gösterme" aynı sırayı izliyor ve
 * kullanıcıya yanlış kaynak bildirilmiyor.
 */
async function locateSecret(account, envVar) {
    const envValue = process.env[envVar];
    if (envValue && envValue.trim()) {
        return { value: envValue.trim(), storage: "env" };
    }
    const keyring = await loadKeyring();
    if (keyring) {
        try {
            const password = new keyring.Entry(SERVICE_NAME, account).getPassword();
            if (password)
                return { value: password, storage: "keychain" };
        }
        catch {
            // Kayıt yok veya keychain okunamadı; dosyaya bakmaya devam et.
        }
    }
    const store = await readFallback();
    const fileValue = store[account];
    return fileValue ? { value: fileValue, storage: "file" } : null;
}
async function readFallback() {
    try {
        const raw = await readFile(FALLBACK_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null)
            return {};
        const store = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value !== "string")
                continue;
            // Tanınmayan anahtarlar korunuyor: eski/yeni sürüm aynı dosyayı
            // paylaştığında birinin yazdığını diğeri silmemeli.
            store[key] = value;
        }
        return store;
    }
    catch (error) {
        if (isNotFound(error))
            return {};
        throw error;
    }
}
async function writeFallback(store) {
    await ensureConfigDir();
    await writeFile(FALLBACK_FILE, `${JSON.stringify(store, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
    // Dosya zaten varsa `writeFile` mode'u uygulamaz; izni açıkça daraltıyoruz.
    await chmod(FALLBACK_FILE, 0o600).catch(() => {
        // Windows'ta POSIX izinleri anlamsız; sessizce geç.
    });
}
async function removeFromFallback(account) {
    const store = await readFallback();
    if (!(account in store))
        return false;
    delete store[account];
    if (Object.keys(store).length === 0) {
        await rm(FALLBACK_FILE, { force: true });
    }
    else {
        await writeFallback(store);
    }
    return true;
}
function isNotFound(error) {
    return (typeof error === "object" &&
        error !== null &&
        error.code === "ENOENT");
}
/** Test amaçlı: config dosyalarının yolunu dışa açar. */
export const paths = {
    configDir: CONFIG_DIR,
    configFile: CONFIG_FILE,
    fallbackFile: FALLBACK_FILE,
    parentDir: dirname(CONFIG_DIR),
};
//# sourceMappingURL=store.js.map