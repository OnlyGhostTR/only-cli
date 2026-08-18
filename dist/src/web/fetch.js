/**
 * Sayfa çekme ve HTML'den okunabilir metin çıkarma.
 *
 * Buradaki URL'ler modelden geliyor, yani ajanın kontrolündeki bir girdi.
 * Bu yüzden adres doğrulaması isteğe bağlı bir iyileştirme değil güvenlik
 * sınırı: doğrulamasız bir `fetch`, modeli ikna eden herkese kullanıcının
 * ağındaki yerel servislere istek attırma imkânı verir (SSRF).
 */
/** Yanıt gövdesi için üst sınır; devasa sayfalar belleği doldurmasın. */
const MAX_BYTES = 2_000_000;
/** Modele verilecek metin için üst sınır; token bütçesini korur. */
const DEFAULT_MAX_CHARS = 20_000;
const TIMEOUT_MS = 15_000;
/**
 * Adresi doğrular ve `URL` olarak döndürür.
 *
 * Reddedilenler ve nedenleri:
 * - `http`/`https` dışı şemalar: `file:` yerel dosya okumaya, `gopher:` gibi
 *   şemalar protokol karıştırmaya açık.
 * - Gömülü kimlik bilgisi (`user:pass@host`): log'a veya geçmişe sızar.
 * - Yerel/özel ağ adresleri: kullanıcının makinesindeki veya LAN'ındaki
 *   servisler internet değil, ajanın erişim alanı dışında.
 */
export function assertSafeUrl(raw) {
    let url;
    try {
        url = new URL(raw.trim());
    }
    catch {
        throw new Error(`geçersiz URL: ${raw}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`yalnızca http/https destekleniyor: ${url.protocol}`);
    }
    if (url.username || url.password) {
        throw new Error("URL içinde kimlik bilgisi taşınamaz");
    }
    if (isPrivateHost(url.hostname)) {
        throw new Error(`yerel veya özel ağ adresi getirilemez: ${url.hostname}`);
    }
    return url;
}
/** Yerel makine, özel ağ ve çözümlenemeyecek tek parçalı adlar. */
export function isPrivateHost(hostname) {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost"))
        return true;
    if (host.endsWith(".local") || host.endsWith(".internal"))
        return true;
    // IPv6 loopback ve link-local.
    if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc")) {
        return true;
    }
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (v4) {
        const parts = v4.slice(1, 5).map((part) => Number(part));
        if (parts.some((part) => part === undefined || part > 255))
            return true;
        const [a = 0, b = 0] = parts;
        if (a === 0 || a === 127 || a === 10)
            return true;
        if (a === 169 && b === 254)
            return true;
        if (a === 172 && b >= 16 && b <= 31)
            return true;
        if (a === 192 && b === 168)
            return true;
        return false;
    }
    // "intranet" gibi noktasız adlar yalnızca yerel çözümlemeyle anlam kazanır.
    if (!host.includes("."))
        return true;
    return false;
}
export async function fetchPage(rawUrl, options = {}) {
    const url = assertSafeUrl(rawUrl);
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    const response = await request(url, options.signal);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
    const type = response.headers.get("content-type") ?? "";
    if (!isTextual(type)) {
        throw new Error(`metin olmayan içerik atlandı (${type || "tür bilinmiyor"})`);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) {
        throw new Error(`içerik çok büyük (${declared} bayt)`);
    }
    const body = await response.text();
    const { title, text } = /html/i.test(type)
        ? htmlToText(body)
        : { title: "", text: body };
    const truncated = text.length > maxChars;
    // Yönlendirme sonrası adres yeniden doğrulanıyor: ilk adres güvenli olsa da
    // sunucu bizi yerel bir adrese yönlendirmiş olabilir.
    const finalUrl = response.url || url.toString();
    if (response.url)
        assertSafeUrl(response.url);
    return {
        url: finalUrl,
        title,
        text: truncated ? `${text.slice(0, maxChars)}\n…[kesildi]` : text,
        truncated,
    };
}
async function request(url, external) {
    // AbortSignal.any() Node 20.3'ten önce yok; iki sinyali elle birleştiriyoruz.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const forward = () => controller.abort();
    external?.addEventListener("abort", forward, { once: true });
    try {
        return await fetch(url, {
            redirect: "follow",
            signal: controller.signal,
            headers: {
                // Bazı siteler user-agent'sız isteklere 403 dönüyor.
                "user-agent": "OnlyCLI/0.1 (+https://github.com/onlycli)",
                accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
                "accept-language": "tr,en;q=0.8",
            },
        });
    }
    catch (error) {
        if (controller.signal.aborted && !external?.aborted) {
            throw new Error(`istek zaman aşımına uğradı (${TIMEOUT_MS / 1000}s)`);
        }
        throw error;
    }
    finally {
        clearTimeout(timer);
        external?.removeEventListener("abort", forward);
    }
}
function isTextual(contentType) {
    const type = contentType.toLowerCase();
    return (type === "" ||
        type.startsWith("text/") ||
        type.includes("json") ||
        type.includes("xml"));
}
/**
 * HTML'i düz metne indirir.
 *
 * Tam bir ayrıştırıcı değil, kasıtlı olarak: modele okunabilir bir gövde
 * yetiyor ve ek bağımlılık getirmemek istiyoruz. Script/style içerikleri
 * atılıyor, blok etiketleri satır sonuna dönüşüyor.
 */
export function htmlToText(html) {
    let source = html.replace(/<!--[\s\S]*?-->/g, " ");
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(source);
    const title = titleMatch
        ? collapseSpaces(decodeEntities(stripTags(titleMatch[1] ?? "")))
        : "";
    source = source.replace(/<(script|style|noscript|svg|canvas|template|iframe|head)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
    source = source.replace(/<br\s*\/?>/gi, "\n");
    source = source.replace(/<li\b[^>]*>/gi, "\n- ");
    source = source.replace(/<\/(p|div|section|article|header|footer|h[1-6]|li|tr|ul|ol|blockquote|pre|table)\s*>/gi, "\n");
    const text = collapseLines(decodeEntities(stripTags(source)));
    return { title, text };
}
function stripTags(value) {
    return value.replace(/<[^>]*>/g, " ");
}
function decodeEntities(value) {
    return value
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}
function collapseSpaces(value) {
    return value.replace(/\s+/g, " ").trim();
}
function collapseLines(value) {
    return value
        .split("\n")
        .map((line) => collapseSpaces(line))
        .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
        .join("\n")
        .trim();
}
//# sourceMappingURL=fetch.js.map