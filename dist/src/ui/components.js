/**
 * Terminal arayüz bileşenleri.
 *
 * Amaç kompaktlık: her bileşen dikey alanı olabildiğince az tüketir, bilgi
 * hiyerarşisi kutu çizmek yerine renk ve girinti ile kurulur. Renkler
 * `theme.ts` üzerinden geldiği için NO_COLOR / boru hattı durumlarında
 * çıktı otomatik olarak düz metne düşer.
 */
import { bold, glyph, stripAnsi, terminalWidth, theme, visibleWidth, } from "./theme.js";
const out = (text) => {
    process.stdout.write(text + "\n");
};
/** Ürün başlığı + oturum bilgisi. Tek satır, iki sütun hizalı. */
export function header(left, right) {
    const width = terminalWidth();
    const brand = bold(theme.accent("OnlyCLI"));
    const leftText = `${brand} ${theme.frame(glyph.vertical)} ${theme.muted(left)}`;
    if (!right) {
        out(leftText);
        return;
    }
    const rightText = theme.muted(right);
    const gap = width - visibleWidth(leftText) - visibleWidth(rightText);
    out(gap > 1 ? leftText + " ".repeat(gap) + rightText : leftText);
}
/** Bölüm ayracı: soluk çizgi ve isteğe bağlı etiket. */
export function rule(label) {
    const width = terminalWidth();
    if (!label) {
        out(theme.frame(glyph.horizontal.repeat(width)));
        return;
    }
    const text = ` ${label} `;
    const remaining = Math.max(0, width - text.length - 2);
    out(theme.frame(glyph.horizontal.repeat(2)) +
        theme.accentDeep(text) +
        theme.frame(glyph.horizontal.repeat(remaining)));
}
/** Etiketli durum satırı; anahtar/değer çiftlerini nokta ile ayırır. */
export function statusLine(parts) {
    const sep = theme.frame(` ${glyph.dot} `);
    out(parts.filter(Boolean).map(theme.muted).join(sep));
}
export function info(message) {
    out(theme.accent(glyph.arrow) + " " + theme.text(message));
}
export function success(message) {
    out(theme.ok(glyph.check) + " " + theme.text(message));
}
export function warn(message) {
    out(theme.warn("!") + " " + theme.text(message));
}
export function failure(message) {
    out(theme.error(glyph.cross) + " " + theme.text(message));
}
export function hint(message) {
    out(theme.muted(`  ${message}`));
}
export function blank() {
    out("");
}
/** Önceden biçimlendirilmiş satırı olduğu gibi basar. */
export function raw(text) {
    out(text);
}
/** Dosya değişikliği başlığı: yol + ekleme/silme sayacı. */
export function fileHeader(path, stats) {
    const counts = theme.added(`+${stats.added}`) + " " + theme.removed(`-${stats.removed}`);
    out(theme.accent(glyph.diamond) +
        " " +
        bold(theme.accent(path)) +
        "  " +
        counts);
}
/**
 * Unified diff'i satır numaralı, kompakt bir görünüme çevirir.
 *
 * `createTwoFilesPatch` çıktısındaki dosya başlıkları atılıyor: dosya adı
 * zaten `fileHeader` ile bir kez gösteriliyor, tekrar etmesi yalnızca yer
 * kaplıyor. Hunk başlıkları da satır numarası sütunu sayesinde gereksizleşiyor;
 * yalnızca atlanan bölgeyi belirtmek için ince bir ayraca dönüştürülüyor.
 */
export function renderDiff(patch) {
    const lines = parsePatch(patch);
    const width = Math.max(3, ...lines.map((l) => String(l.newNo ?? l.oldNo ?? "").length));
    const rendered = [];
    for (const line of lines) {
        if (line.kind === "hunk") {
            rendered.push(theme.frame(" ".repeat(width) + " " + glyph.bar + " ") +
                theme.frame(glyph.ellipsis));
            continue;
        }
        const no = line.kind === "remove" ? line.oldNo : line.newNo;
        const gutter = String(no ?? "").padStart(width);
        if (line.kind === "add") {
            rendered.push(theme.added(gutter) +
                theme.frame(" " + glyph.bar + " ") +
                theme.added("+ " + line.text));
        }
        else if (line.kind === "remove") {
            rendered.push(theme.removed(gutter) +
                theme.frame(" " + glyph.bar + " ") +
                theme.removed("- " + line.text));
        }
        else {
            rendered.push(theme.frame(gutter) +
                theme.frame(" " + glyph.bar + " ") +
                theme.muted("  " + line.text));
        }
    }
    return rendered;
}
/** Diff'i girintili olarak basar. */
export function printDiff(patch, indent = "  ") {
    for (const line of renderDiff(patch))
        out(indent + line);
}
function parsePatch(patch) {
    const result = [];
    let oldNo = 0;
    let newNo = 0;
    let seenHunk = false;
    for (const raw of patch.split("\n")) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line.startsWith("---") ||
            line.startsWith("+++") ||
            line.startsWith("===")) {
            continue;
        }
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) {
            oldNo = Number(hunk[1]);
            newNo = Number(hunk[2]);
            // İlk hunk'tan önce ayraç göstermek gereksiz.
            if (seenHunk)
                result.push({ kind: "hunk", text: "" });
            seenHunk = true;
            continue;
        }
        if (!seenHunk)
            continue;
        if (line.startsWith("+")) {
            result.push({ kind: "add", text: line.slice(1), newNo });
            newNo++;
        }
        else if (line.startsWith("-")) {
            result.push({ kind: "remove", text: line.slice(1), oldNo });
            oldNo++;
        }
        else if (line.startsWith("\\")) {
            // "\ No newline at end of file" — gösterilmesi gerekmiyor.
            continue;
        }
        else {
            // Son satır boş olabilir; patch sonundaki artığı basmıyoruz.
            const text = line.startsWith(" ") ? line.slice(1) : line;
            result.push({ kind: "context", text, oldNo, newNo });
            oldNo++;
            newNo++;
        }
    }
    // Patch sonundaki boş context satırlarını kırp.
    while (result.length > 0 &&
        result[result.length - 1]?.kind === "context" &&
        stripAnsi(result[result.length - 1]?.text ?? "").trim() === "") {
        result.pop();
    }
    return result;
}
/**
 * Tek satırlık ilerleme göstergesi.
 *
 * Yalnızca TTY'de animasyon yapar; boru hattında veya CI'da tek bir statik
 * satır basar, böylece log dosyaları kontrol karakterleriyle kirlenmez.
 */
export class Spinner {
    text;
    static FRAMES_UNICODE = [
        "⠋",
        "⠙",
        "⠹",
        "⠸",
        "⠼",
        "⠴",
        "⠦",
        "⠧",
        "⠇",
        "⠏",
    ];
    static FRAMES_ASCII = ["|", "/", "-", "\\"];
    timer;
    index = 0;
    active = false;
    constructor(text) {
        this.text = text;
    }
    start() {
        if (!process.stdout.isTTY) {
            process.stdout.write(theme.muted(this.text + glyph.ellipsis) + "\n");
            return this;
        }
        this.active = true;
        const frames = glyph.dot === "·" ? Spinner.FRAMES_UNICODE : Spinner.FRAMES_ASCII;
        this.timer = setInterval(() => {
            const frame = frames[this.index % frames.length] ?? "";
            this.index++;
            process.stdout.write(`\r${theme.accent(frame)} ${theme.muted(this.text)}`);
        }, 90);
        // Spinner süreci canlı tutmasın.
        this.timer.unref?.();
        return this;
    }
    /** Satırı temizleyip imleci başa alır. */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
        if (this.active && process.stdout.isTTY) {
            const width = (process.stdout.columns ?? 80) - 1;
            process.stdout.write("\r" + " ".repeat(Math.max(0, width)) + "\r");
        }
        this.active = false;
    }
}
/** Token kullanımını okunabilir biçimde özetler. */
export function usageSummary(usage) {
    const total = usage.inputTokens + usage.outputTokens;
    return `${format(usage.inputTokens)} girdi ${glyph.arrow} ${format(usage.outputTokens)} çıktı ${theme.frame(glyph.dot)} ${format(total)} toplam token`;
}
function format(value) {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
//# sourceMappingURL=components.js.map