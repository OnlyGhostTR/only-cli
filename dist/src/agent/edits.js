/**
 * Model çıktısından dosya değişikliklerini ayıklar.
 *
 * MVP'de tool-calling yerine katı bir metin protokolü kullanıyoruz: model
 * değişiklikleri aşağıdaki blok formatıyla bildirir. Bu, iki sağlayıcıda da
 * aynı şekilde çalışır ve provider-agnostic katmanı bozmaz.
 *
 * ```onlycli:write path=src/index.ts
 * <dosyanın tam yeni içeriği>
 * ```
 */
const FENCE = "```";
/** Modele verilen protokol tanımı; system prompt'ta birebir kullanılır. */
export const EDIT_PROTOCOL = `Bir dosyayı oluşturmak veya değiştirmek istediğinde şu formatı kullan:

${FENCE}onlycli:write path=<çalışma dizinine göreli yol>
<dosyanın TAM yeni içeriği>
${FENCE}

Kurallar:
- Yolu her zaman çalışma dizinine göreli ver, mutlak yol veya ".." kullanma.
- Blok içine kısmi içerik, "..." veya "değişmedi" gibi yer tutucular YAZMA; dosyanın tamamını yaz.
- Birden fazla dosya için birden fazla blok kullan.
- Dosya değişikliği gerekmiyorsa hiç blok yazma, sadece açıklama yap.`;
/**
 * Yanıtı açıklama metni ve önerilen düzenlemeler olarak ayırır.
 * Kapanmamış blok varsa yok sayılır — yarım içerikle dosya yazmak veri kaybıdır.
 */
export function parseResponse(text) {
    const lines = text.split("\n");
    const prose = [];
    const edits = [];
    let index = 0;
    while (index < lines.length) {
        const line = lines[index] ?? "";
        const header = matchHeader(line);
        if (!header) {
            prose.push(line);
            index++;
            continue;
        }
        const body = [];
        let closed = false;
        let cursor = index + 1;
        while (cursor < lines.length) {
            const current = lines[cursor] ?? "";
            if (current.trimEnd() === FENCE) {
                closed = true;
                break;
            }
            body.push(current);
            cursor++;
        }
        if (!closed) {
            // Kapanmamış blok: ham metin olarak bırak, düzenleme olarak sayma.
            prose.push(line);
            index++;
            continue;
        }
        edits.push({ path: header, content: normalizeContent(body) });
        index = cursor + 1;
    }
    return { prose: prose.join("\n").trim(), edits };
}
/** ```onlycli:write path=... satırından yolu çıkarır. */
function matchHeader(line) {
    const match = /^```onlycli:write\s+path=(.+?)\s*$/.exec(line.trim());
    if (!match)
        return null;
    const raw = match[1];
    if (!raw)
        return null;
    return stripQuotes(raw.trim());
}
function stripQuotes(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
/** Dosya sonunda tek bir newline garanti eder. */
function normalizeContent(body) {
    const joined = body.join("\n");
    return joined.endsWith("\n") ? joined : `${joined}\n`;
}
//# sourceMappingURL=edits.js.map