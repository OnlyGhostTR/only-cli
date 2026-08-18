import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
/** Context'e alınacak tek dosya için üst sınır (karakter). */
const MAX_FILE_CHARS = 100_000;
/** Otomatik proje taramasında toplam üst sınır. */
const MAX_SCAN_CHARS = 60_000;
const MAX_SCAN_FILES = 40;
const IGNORED_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    "coverage",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    "target",
    "obj",
    ".idea",
    ".vscode",
]);
const TEXT_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".txt",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".cs",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".php",
    ".swift",
    ".sh",
    ".yml",
    ".yaml",
    ".toml",
    ".html",
    ".css",
    ".scss",
    ".sql",
    ".gd",
    ".lua",
    ".vue",
    ".svelte",
]);
/** Sır içermesi muhtemel dosyalar; context'e asla otomatik girmez. */
const SENSITIVE_PATTERNS = [
    /(^|[/\\])\.env(\..*)?$/i,
    /(^|[/\\])credentials?\.json$/i,
    /(^|[/\\])id_(rsa|dsa|ecdsa|ed25519)$/i,
    /\.(pem|key|p12|pfx|keystore)$/i,
    /(^|[/\\])\.npmrc$/i,
    /(^|[/\\])\.aws([/\\]|$)/i,
];
export class PathEscapeError extends Error {
    constructor(path) {
        super(`Çalışma dizininin dışına çıkılamaz: ${path}`);
        this.name = "PathEscapeError";
    }
}
/**
 * Yolu çalışma dizini içine sabitler. `..` ile dışarı çıkma ve mutlak yol
 * enjeksiyonunu engeller — agent'ın yazma yetkisi olduğu için bu şart.
 */
export function resolveInsideCwd(path, cwd = process.cwd()) {
    const base = resolve(cwd);
    const target = isAbsolute(path) ? resolve(path) : resolve(base, path);
    if (target !== base && !target.startsWith(base + sep)) {
        throw new PathEscapeError(path);
    }
    return target;
}
export function isSensitivePath(path) {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(path));
}
/** Tek bir dosyayı context için okur. */
export async function readFileContext(path, cwd = process.cwd()) {
    const absolute = resolveInsideCwd(path, cwd);
    const raw = await readFile(absolute, "utf8");
    const truncated = raw.length > MAX_FILE_CHARS;
    return {
        relativePath: toPosix(relative(resolve(cwd), absolute)),
        content: truncated ? raw.slice(0, MAX_FILE_CHARS) : raw,
        truncated,
    };
}
export async function readFileContexts(paths, cwd = process.cwd()) {
    const results = [];
    for (const path of paths) {
        results.push(await readFileContext(path, cwd));
    }
    return results;
}
/**
 * Projeyi hafifçe tarar: ignore listesindeki klasörleri, binary uzantıları ve
 * sır içerebilecek dosyaları atlar; toplam karakter bütçesini aşmaz.
 */
export async function scanProject(cwd = process.cwd()) {
    const base = resolve(cwd);
    const collected = [];
    let budget = MAX_SCAN_CHARS;
    async function walk(dir, depth) {
        if (depth > 4 || collected.length >= MAX_SCAN_FILES || budget <= 0)
            return;
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        }
        catch {
            return; // izin yok / okunamıyor
        }
        // Dosyaları önce işleyip klasörlere sonra inmek, kök dizindeki önemli
        // dosyaların bütçeyi kaçırmamasını sağlıyor.
        const dirs = entries.filter((e) => e.isDirectory());
        const files = entries.filter((e) => e.isFile());
        for (const entry of files) {
            if (collected.length >= MAX_SCAN_FILES || budget <= 0)
                return;
            const absolute = join(dir, entry.name);
            const rel = toPosix(relative(base, absolute));
            if (isSensitivePath(rel) || !TEXT_EXTENSIONS.has(extname(entry.name))) {
                continue;
            }
            try {
                const info = await stat(absolute);
                if (info.size > 200_000)
                    continue;
                const raw = await readFile(absolute, "utf8");
                const slice = raw.slice(0, budget);
                budget -= slice.length;
                collected.push({
                    relativePath: rel,
                    content: slice,
                    truncated: slice.length < raw.length,
                });
            }
            catch {
                continue;
            }
        }
        for (const entry of dirs) {
            if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith("."))
                continue;
            await walk(join(dir, entry.name), depth + 1);
        }
    }
    await walk(base, 0);
    return collected;
}
/** Dosya içeriklerini modele verilecek tek bir metne dönüştürür. */
export function formatContext(files) {
    if (files.length === 0)
        return "";
    return files
        .map((file) => {
        const note = file.truncated ? " (kısaltıldı)" : "";
        return `--- ${file.relativePath}${note} ---\n${file.content}`;
    })
        .join("\n\n");
}
/** Onay alındıktan sonra dosyaya yazar. */
export async function writeFileSafe(path, content, cwd = process.cwd()) {
    const absolute = resolveInsideCwd(path, cwd);
    await writeFile(absolute, content, "utf8");
    return toPosix(relative(resolve(cwd), absolute));
}
export async function fileExists(path, cwd = process.cwd()) {
    try {
        await stat(resolveInsideCwd(path, cwd));
        return true;
    }
    catch {
        return false;
    }
}
function toPosix(path) {
    return path.split(sep).join("/");
}
/**
 * Dosyanın baskın satır sonu karakterini bulur.
 *
 * Modeller içeriği neredeyse her zaman LF ile üretiyor. Windows'ta CRLF bir
 * dosyaya bunu olduğu gibi yazarsak diff dosyanın tamamını değişmiş gösterir ve
 * tek satırlık bir düzeltme, tüm satır sonlarını değiştiren bir commit'e dönüşür.
 */
export function detectEol(content) {
    const crlf = (content.match(/\r\n/g) ?? []).length;
    if (crlf === 0)
        return "\n";
    const lf = (content.match(/\n/g) ?? []).length;
    // Yarısından fazlası CRLF ise dosyayı CRLF kabul et.
    return crlf * 2 >= lf ? "\r\n" : "\n";
}
/** İçeriği verilen satır sonu biçimine normalize eder. */
export function applyEol(content, eol) {
    const normalized = content.replace(/\r\n/g, "\n");
    return eol === "\n" ? normalized : normalized.replace(/\n/g, "\r\n");
}
/**
 * Modelin ürettiği içeriği hedef dosyanın mevcut satır sonu biçimine uydurur.
 * Dosya yoksa platform varsayılanı yerine LF seçilir; yeni dosyalarda LF
 * ekosistem genelinde güvenli varsayılan.
 */
export function matchEolTo(existing, incoming) {
    if (existing === "")
        return applyEol(incoming, "\n");
    return applyEol(incoming, detectEol(existing));
}
//# sourceMappingURL=files.js.map