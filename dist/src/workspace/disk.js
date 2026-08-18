/**
 * Disk hedefi: bugüne kadarki davranış.
 *
 * Mantığın tamamı `utils/files.ts` içinde duruyor; bu dosya onu `Workspace`
 * sözleşmesine bağlayan ince bir katman. Kasıtlı olarak ince: dosya okuma,
 * sandbox kuralı ve satır sonu eşleme zaten test edilmiş durumda, hedef
 * soyutlaması eklerken o davranışı yeniden yazmak gereksiz risk olurdu.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileExists, isSensitivePath, matchEolTo, PathEscapeError as DiskPathEscapeError, readFileContexts, resolveInsideCwd, scanProject, writeFileSafe, } from "../utils/files.js";
import { PathEscapeError, } from "./base.js";
export class DiskWorkspace {
    kind = "disk";
    /** Sandbox kökü. `/cd` ile değişebildiği için readonly değil. */
    cwd;
    constructor(cwd) {
        this.cwd = cwd;
    }
    get label() {
        return this.cwd;
    }
    get root() {
        return this.cwd;
    }
    /** Oturum dizin değiştirdiğinde sandbox kökü de taşınır. */
    changeRoot(next) {
        this.cwd = next;
    }
    async read(paths) {
        const contexts = await this.translate(() => readFileContexts(paths, this.cwd));
        return contexts.map((file) => toWorkspaceFile(file.relativePath, file.content));
    }
    async scan() {
        const contexts = await scanProject(this.cwd);
        return contexts.map((file) => toWorkspaceFile(file.relativePath, file.content));
    }
    async readCurrent(path) {
        const target = await this.translate(async () => resolveInsideCwd(path, this.cwd));
        if (!(await fileExists(path, this.cwd)))
            return null;
        return readFile(target, "utf8");
    }
    async write(path, content) {
        const before = await this.readCurrent(path);
        // Model çıktısı LF gelir; mevcut dosya CRLF ise biçimi koruyoruz, aksi
        // hâlde diff tüm dosyayı değişmiş gösterir.
        const after = matchEolTo(before ?? "", content);
        const written = await this.translate(() => writeFileSafe(path, after, this.cwd));
        return { path: written, created: before === null };
    }
    isProtected(path) {
        return isSensitivePath(path);
    }
    promptGuidance() {
        return "";
    }
    /**
     * files.ts kendi `PathEscapeError`'ını fırlatıyor. Çağıran katmanın hangi
     * hedefte çalıştığını bilmeden tek bir hata tipini yakalayabilmesi için
     * workspace tipine çeviriyoruz.
     */
    async translate(operation) {
        try {
            return await operation();
        }
        catch (error) {
            if (error instanceof DiskPathEscapeError) {
                throw new PathEscapeError(extractPath(error.message));
            }
            throw error;
        }
    }
}
function toWorkspaceFile(path, content) {
    const language = languageOf(path);
    return { path, content, ...(language ? { language } : {}) };
}
/** Uzantıdan markdown dil etiketi; bilinmeyende etiket koymuyoruz. */
function languageOf(path) {
    const map = {
        ".ts": "ts",
        ".tsx": "tsx",
        ".js": "js",
        ".jsx": "jsx",
        ".json": "json",
        ".lua": "lua",
        ".luau": "lua",
        ".py": "python",
        ".cs": "csharp",
        ".md": "md",
        ".yml": "yaml",
        ".yaml": "yaml",
        ".sh": "bash",
    };
    return map[extname(path).toLowerCase()];
}
/** Hata mesajının başındaki yolu geri alır; mesaj biçimi files.ts'te sabit. */
function extractPath(message) {
    const space = message.indexOf(" ");
    return space > 0 ? message.slice(0, space) : message;
}
//# sourceMappingURL=disk.js.map