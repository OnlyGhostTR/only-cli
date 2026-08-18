/**
 * Renk paleti ve terminal yetenek tespiti.
 *
 * Palet koyu gri + mavi tonlarında: gri hiyerarşiyi (çerçeve, ikincil bilgi),
 * mavi ise dikkat çekmesi gereken yerleri (başlık, dosya adı, soru) taşıyor.
 * Diff'te ekleme/silme için yeşil-kırmızı korunuyor; renk körlüğünde ayrımın
 * tek dayanağı renk olmasın diye satır başlarında +/- işaretleri de var.
 */
/** NO_COLOR standardı ve FORCE_COLOR'a saygı gösterir. */
export const supportsColor = detectColor();
/** 24-bit renk desteği; yoksa 16 renge düşülür. */
export const supportsTrueColor = supportsColor && detectTrueColor();
/**
 * Windows'ta eski kod sayfalarında (cp857 vb.) kutu çizgileri bozuk görünüyor.
 * Kullanıcı ONLYCLI_ASCII=1 ile ASCII'ye zorlayabilir.
 */
export const supportsUnicode = detectUnicode();
function detectColor() {
    const env = process.env;
    if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "")
        return false;
    if (env["FORCE_COLOR"] !== undefined)
        return env["FORCE_COLOR"] !== "0";
    if (env["TERM"] === "dumb")
        return false;
    return process.stdout.isTTY === true;
}
function detectTrueColor() {
    const env = process.env;
    const colorterm = env["COLORTERM"] ?? "";
    if (/truecolor|24bit/i.test(colorterm))
        return true;
    // Windows Terminal ve VS Code entegre terminali 24-bit destekler.
    if (env["WT_SESSION"])
        return true;
    if (env["TERM_PROGRAM"] === "vscode")
        return true;
    return false;
}
function detectUnicode() {
    const env = process.env;
    if (env["ONLYCLI_ASCII"] === "1")
        return false;
    if (process.platform !== "win32")
        return true;
    // Windows Terminal / VS Code UTF-8 ile çalışır.
    return Boolean(env["WT_SESSION"] || env["TERM_PROGRAM"] === "vscode");
}
/** 24-bit renk üretir. */
function rgb(r, g, b) {
    const open = `\u001B[38;2;${r};${g};${b}m`;
    return (text) => `${open}${text}\u001B[39m`;
}
/** 16 renkli fallback (ANSI kod numarasıyla). */
function ansi(code) {
    const open = `\u001B[${code}m`;
    return (text) => `${open}${text}\u001B[39m`;
}
function pick(trueColor, fallback) {
    if (!supportsColor)
        return identity;
    return supportsTrueColor ? trueColor : fallback;
}
const identity = (text) => text;
export const bold = supportsColor
    ? (text) => `\u001B[1m${text}\u001B[22m`
    : identity;
export const italic = supportsColor
    ? (text) => `\u001B[3m${text}\u001B[23m`
    : identity;
export const underline = supportsColor
    ? (text) => `\u001B[4m${text}\u001B[24m`
    : identity;
export const theme = {
    /** En soluk gri: çerçeveler, ayraç çizgileri. */
    frame: pick(rgb(0x4b, 0x55, 0x63), ansi(90)),
    /** İkincil metin: durum satırı, ipuçları. */
    muted: pick(rgb(0x8b, 0x95, 0xa5), ansi(90)),
    /** Nötr metin: model yanıtının gövdesi. */
    text: pick(rgb(0xd4, 0xd8, 0xde), identity),
    /** Ana mavi: başlıklar, dosya adları. */
    accent: pick(rgb(0x60, 0xa5, 0xfa), ansi(94)),
    /** Koyu mavi: daha az öne çıkması gereken mavi öğeler. */
    accentDeep: pick(rgb(0x3b, 0x82, 0xf6), ansi(34)),
    /** Açık mavi: satır içi kod, vurgular. */
    accentSoft: pick(rgb(0x93, 0xc5, 0xfd), ansi(96)),
    added: pick(rgb(0x4a, 0xde, 0x80), ansi(92)),
    removed: pick(rgb(0xf8, 0x71, 0x71), ansi(91)),
    warn: pick(rgb(0xfb, 0xbf, 0x24), ansi(93)),
    error: pick(rgb(0xf8, 0x71, 0x71), ansi(91)),
    ok: pick(rgb(0x4a, 0xde, 0x80), ansi(92)),
};
/** Kutu ve işaret karakterleri; ASCII fallback'i ile. */
export const glyph = supportsUnicode
    ? {
        topLeft: "╭",
        topRight: "╮",
        bottomLeft: "╰",
        bottomRight: "╯",
        horizontal: "─",
        vertical: "│",
        bar: "▏",
        diamond: "◆",
        dot: "·",
        arrow: "›",
        check: "✓",
        cross: "✗",
        equals: "=",
        ellipsis: "…",
    }
    : {
        topLeft: "+",
        topRight: "+",
        bottomLeft: "+",
        bottomRight: "+",
        horizontal: "-",
        vertical: "|",
        bar: "|",
        diamond: "*",
        dot: "-",
        arrow: ">",
        check: "+",
        cross: "x",
        equals: "=",
        ellipsis: "...",
    };
/**
 * ANSI kaçış dizilerini sayarak değil, görünen karakter sayısını verir.
 * Hizalama hesapları için gerekli.
 */
export function visibleWidth(text) {
    return stripAnsi(text).length;
}
export function stripAnsi(text) {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\u001B\[[0-9;]*m/g, "");
}
/** Kullanılabilir terminal genişliği; okunabilirlik için üstten sınırlı. */
export function terminalWidth(max = 100) {
    const columns = process.stdout.columns;
    if (!columns || columns < 20)
        return 80;
    return Math.min(columns, max);
}
//# sourceMappingURL=theme.js.map