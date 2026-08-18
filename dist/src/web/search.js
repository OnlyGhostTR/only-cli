/**
 * Web araması. Sağlayıcıdan bağımsız tek bir `search()` girişi sunar.
 *
 * Seçim sırası: kullanıcının anahtar verdiği bir backend varsa (Brave, Tavily)
 * o kullanılır; yoksa anahtarsız DuckDuckGo HTML uçnoktasına düşülür.
 * Anahtarsız yol kurulum gerektirmediği için ilk deneyimi kolaylaştırıyor,
 * fakat kazımaya dayandığı için kırılgan: biçim değişebilir ve yoğun kullanımda
 * hız sınırına takılır. Bu yüzden geri dönüş yolu, tercih edilen yol değil.
 */
import { getSearchKey } from "../config/store.js";
import { htmlToText } from "./fetch.js";
import { SEARCH_BACKENDS, } from "./types.js";
const TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 5;
/** Snippet'ler modele özet olarak gidiyor; uzun olanları kırpıyoruz. */
const MAX_SNIPPET_CHARS = 300;
/**
 * Kullanılabilecek arama yolunu belirler.
 *
 * `null` dönmez: anahtar bulunamazsa "duckduckgo" döner, çünkü anahtarsız yol
 * her zaman devrede.
 */
export async function resolveSearchSource(preferred) {
    if (preferred)
        return preferred;
    for (const backend of SEARCH_BACKENDS) {
        if (await getSearchKey(backend))
            return backend;
    }
    return "duckduckgo";
}
export async function search(query, options = {}) {
    const trimmed = query.trim();
    if (!trimmed)
        throw new Error("arama sorgusu boş olamaz");
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 10);
    const source = await resolveSearchSource(options.backend);
    const results = await runBackend(source, trimmed, limit, options.signal);
    return { source, query: trimmed, results: results.slice(0, limit) };
}
async function runBackend(source, query, limit, signal) {
    switch (source) {
        case "brave":
            return searchBrave(query, limit, signal);
        case "tavily":
            return searchTavily(query, limit, signal);
        case "duckduckgo":
            return searchDuckDuckGo(query, signal);
    }
}
async function requireKey(backend) {
    const key = await getSearchKey(backend);
    if (!key) {
        throw new Error(`${backend} için arama anahtarı yok. Eklemek için: onlycli auth search add --backend ${backend}`);
    }
    return key;
}
async function searchBrave(query, limit, signal) {
    const key = await requireKey("brave");
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(limit));
    const response = await withTimeout((innerSignal) => fetch(url, {
        headers: {
            accept: "application/json",
            "x-subscription-token": key,
        },
        signal: innerSignal,
    }), signal);
    if (!response.ok)
        throw await backendError("Brave", response);
    const body = (await response.json());
    return (body.web?.results ?? [])
        .filter((item) => typeof item.url === "string")
        .map((item) => ({
        title: item.title?.trim() ?? item.url,
        url: item.url,
        snippet: snippet(item.description ?? ""),
    }));
}
async function searchTavily(query, limit, signal) {
    const key = await requireKey("tavily");
    const response = await withTimeout((innerSignal) => fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
            query,
            max_results: limit,
            search_depth: "basic",
        }),
        signal: innerSignal,
    }), signal);
    if (!response.ok)
        throw await backendError("Tavily", response);
    const body = (await response.json());
    return (body.results ?? [])
        .filter((item) => typeof item.url === "string")
        .map((item) => ({
        title: item.title?.trim() ?? item.url,
        url: item.url,
        snippet: snippet(item.content ?? ""),
    }));
}
/**
 * Anahtarsız yol: DuckDuckGo'nun JavaScript'siz HTML arayüzü.
 *
 * Resmî bir API değil; sonuç bulunamaması bir hata değil "sonuç yok" olarak
 * yorumlanabilir, fakat biçim değiştiğinde de aynı sonuç ortaya çıkar. Bu
 * ayrımı yapamadığımız için çağıran katmana anahtar önerisi yaptırıyoruz.
 */
async function searchDuckDuckGo(query, signal) {
    const url = new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", query);
    const response = await withTimeout((innerSignal) => fetch(url, {
        headers: {
            "user-agent": "Mozilla/5.0 (compatible; OnlyCLI/0.1; +https://github.com/onlycli)",
            accept: "text/html",
        },
        signal: innerSignal,
    }), signal);
    if (!response.ok)
        throw await backendError("DuckDuckGo", response);
    return parseDuckDuckGoHtml(await response.text());
}
/** Ayrı fonksiyon: ağ olmadan test edilebilmesi için. */
export function parseDuckDuckGoHtml(html) {
    const results = [];
    const blocks = html.split(/<div[^>]*class="[^"]*\bresult\b[^"]*"/i).slice(1);
    for (const block of blocks) {
        const anchor = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        if (!anchor)
            continue;
        const href = decodeRedirect(anchor[1] ?? "");
        if (!href)
            continue;
        const title = htmlToText(anchor[2] ?? "").text;
        const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        const description = snippetMatch ? htmlToText(snippetMatch[1] ?? "").text : "";
        results.push({
            title: title || href,
            url: href,
            snippet: snippet(description),
        });
    }
    return results;
}
/**
 * DuckDuckGo bağlantıları `/l/?uddg=<kodlanmış>` sarmalayıcısıyla geliyor.
 * Modele sarmalayıcıyı vermek işe yaramaz; gerçek adresi çıkarıyoruz.
 */
function decodeRedirect(href) {
    const raw = href.startsWith("//") ? `https:${href}` : href;
    try {
        const url = new URL(raw, "https://duckduckgo.com");
        const target = url.searchParams.get("uddg");
        if (target)
            return target;
        if (url.protocol === "http:" || url.protocol === "https:") {
            return url.toString();
        }
        return null;
    }
    catch {
        return null;
    }
}
function snippet(value) {
    const clean = value.replace(/\s+/g, " ").trim();
    return clean.length > MAX_SNIPPET_CHARS
        ? `${clean.slice(0, MAX_SNIPPET_CHARS)}…`
        : clean;
}
/**
 * 401/429 gibi durumlar kullanıcı eylemi gerektiriyor; ham gövde yerine ne
 * yapılacağını söyleyen bir mesaj üretiyoruz.
 */
async function backendError(label, response) {
    const detail = await response.text().catch(() => "");
    const short = detail.replace(/\s+/g, " ").trim().slice(0, 200);
    if (response.status === 401 || response.status === 403) {
        return new Error(`${label} anahtarı geçersiz veya yetkisiz (HTTP ${response.status}).`);
    }
    if (response.status === 429) {
        return new Error(`${label} hız sınırına takıldı (HTTP 429). Biraz bekleyip tekrar dene.`);
    }
    return new Error(`${label} araması başarısız (HTTP ${response.status})${short ? `: ${short}` : ""}`);
}
/** Zaman aşımı ile çağıranın iptal sinyalini birleştirir. */
async function withTimeout(run, external) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const forward = () => controller.abort();
    external?.addEventListener("abort", forward, { once: true });
    try {
        return await run(controller.signal);
    }
    catch (error) {
        if (controller.signal.aborted && !external?.aborted) {
            throw new Error(`arama zaman aşımına uğradı (${TIMEOUT_MS / 1000}s)`);
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
        external?.removeEventListener("abort", forward);
    }
}
//# sourceMappingURL=search.js.map