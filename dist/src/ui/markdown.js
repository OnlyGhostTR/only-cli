/**
 * Akış dostu (streaming) markdown vurgulayıcı.
 *
 * Model yanıtı parça parça geldiği için tam metni bekleyip render edemeyiz:
 * gelen karakterler bir tampona yazılır, yalnızca satır tamamlandığında
 * biçimlendirilip basılır. Bu yüzden blok yapısı (kod çiti, liste, başlık)
 * satır bazında ele alınıyor; satır ortasında kalan biçimlendirme sonraki
 * parçayı beklemeden bozulmuyor.
 */
import { bold, glyph, italic, theme } from "./theme.js";
/** Kod çitinin dilini kullanıcıya göstermek için etiketler. */
const FENCE = /^\s*```(.*)$/;
export class MarkdownRenderer {
    buffer = "";
    inCode = false;
    codeLang = "";
    indent;
    write;
    constructor(options = {}) {
        this.indent = options.indent ?? "";
        this.write = options.write ?? ((text) => process.stdout.write(text));
    }
    /** Akıştan gelen metin parçasını işler. */
    push(chunk) {
        this.buffer += chunk;
        let index = this.buffer.indexOf("\n");
        while (index !== -1) {
            const line = this.buffer.slice(0, index);
            this.buffer = this.buffer.slice(index + 1);
            this.write(this.renderLine(stripCr(line)) + "\n");
            index = this.buffer.indexOf("\n");
        }
    }
    /** Akış bittiğinde tamponda kalan son satırı basar. */
    end() {
        if (this.buffer.length > 0) {
            this.write(this.renderLine(stripCr(this.buffer)) + "\n");
            this.buffer = "";
        }
    }
    renderLine(line) {
        const fence = FENCE.exec(line);
        if (fence) {
            if (this.inCode) {
                this.inCode = false;
                this.codeLang = "";
                return this.indent + theme.frame(glyph.bottomLeft + glyph.horizontal.repeat(2));
            }
            this.inCode = true;
            this.codeLang = (fence[1] ?? "").trim();
            const label = this.codeLang ? ` ${this.codeLang} ` : "";
            return (this.indent +
                theme.frame(glyph.topLeft + glyph.horizontal.repeat(2)) +
                (label ? theme.muted(label) : ""));
        }
        if (this.inCode) {
            // Kod içeriğine dokunmuyoruz; yalnızca sol kenar çubuğu ekliyoruz.
            return this.indent + theme.frame(glyph.bar) + " " + theme.accentSoft(line);
        }
        return this.indent + renderInline(line);
    }
}
/** Tek seferde tam metni biçimlendirir (akış olmayan yerler için). */
export function renderMarkdown(text, indent = "") {
    const chunks = [];
    const renderer = new MarkdownRenderer({
        indent,
        write: (part) => chunks.push(part),
    });
    renderer.push(text);
    renderer.end();
    return chunks.join("").replace(/\n$/, "");
}
function stripCr(line) {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
}
/** Blok düzeyi (başlık, liste, alıntı) + satır içi biçimlendirme. */
function renderInline(line) {
    if (line.trim() === "")
        return "";
    // Yatay ayraç
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
        return theme.frame(glyph.horizontal.repeat(24));
    }
    // Başlıklar: seviyeye göre mavinin tonu değişir.
    const heading = /^(\s*)(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
        const [, pad = "", hashes = "", content = ""] = heading;
        const color = hashes.length <= 2 ? theme.accent : theme.accentDeep;
        return pad + bold(color(emphasize(content, color)));
    }
    // Alıntı
    const quote = /^(\s*)>\s?(.*)$/.exec(line);
    if (quote) {
        const [, pad = "", content = ""] = quote;
        return pad + theme.frame(glyph.bar + " ") + theme.muted(content);
    }
    // Sırasız liste: madde işareti maviye, içerik nötr.
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
        const [, pad = "", content = ""] = bullet;
        return pad + theme.accent(glyph.dot + " ") + emphasize(content, theme.text);
    }
    // Sıralı liste
    const ordered = /^(\s*)(\d+)([.)])\s+(.*)$/.exec(line);
    if (ordered) {
        const [, pad = "", num = "", sep = "", content = ""] = ordered;
        return (pad + theme.accent(num + sep) + " " + emphasize(content, theme.text));
    }
    // Tablo satırı: hücre ayraçlarını soluklaştır.
    if (/^\s*\|.*\|\s*$/.test(line)) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line))
            return theme.frame(line);
        return line.replace(/\|/g, (pipe) => theme.frame(pipe));
    }
    return emphasize(line, theme.text);
}
/**
 * Satır içi `kod`, **kalın** ve *italik* biçimlendirmesi.
 *
 * Önce kod parçalarını yer tutucuya alıyoruz: kod içindeki yıldız veya alt
 * çizgi karakterlerinin vurgu olarak yorumlanmasını engelliyor.
 */
function emphasize(text, base) {
    const codes = [];
    let work = text.replace(/`([^`]+)`/g, (_match, code) => {
        codes.push(code);
        return `\u0000${codes.length - 1}\u0000`;
    });
    work = work.replace(/\*\*([^*]+)\*\*/g, (_m, inner) => bold(String(inner)));
    work = work.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, (_m, lead, inner) => `${lead}${italic(String(inner))}`);
    work = base(work);
    // Yer tutucuları renkli koda çevir. Kod, gövde renginden ayrışsın diye
    // açık mavi; böylece komut ve tanımlayıcılar metin içinde seçilebiliyor.
    return work.replace(/\u0000(\d+)\u0000/g, (_m, index) => {
        const code = codes[Number(index)] ?? "";
        return theme.accentSoft(code);
    });
}
//# sourceMappingURL=markdown.js.map