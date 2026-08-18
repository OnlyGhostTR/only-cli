/**
 * Ajanın üzerinde çalıştığı hedef soyutlaması.
 *
 * `providers/base.ts` modelden bağımsızlığı sağlıyor; bu dosya da hedeften
 * bağımsızlığı sağlıyor. `turn.ts` dosyaların diskte mi yoksa Roblox Studio
 * instance ağacında mı olduğunu bilmez, yalnızca bu arayüzle konuşur.
 *
 * Ayrımın sebebi somut: Roblox Studio'da dosya sistemi yok. Bir script'in
 * "yolu" `ServerScriptService/Combat/Sword` gibi bir instance yoludur; ne
 * mutlak yol, ne uzantı, ne de dizin kavramı aynı anlama gelir. Aynı durum
 * ileride Unity/Godot için de geçerli olacak, o yüzden hedefi baştan
 * değiştirilebilir tutuyoruz.
 */
/** Hedef sınırının dışına çıkan yol. */
export class PathEscapeError extends Error {
    constructor(path) {
        super(`${path} çalışma alanının dışında; ajan yalnızca bu alanın içinde değişiklik yapabilir.`);
        this.name = "PathEscapeError";
    }
}
/** Hedefte bulunamayan kaynak. */
export class NotFoundError extends Error {
    constructor(path) {
        super(`Bulunamadı: ${path}`);
        this.name = "NotFoundError";
    }
}
/**
 * Context bloğunu modele verilecek metne çevirir.
 *
 * Hedeften bağımsız tutuluyor: Studio'dan gelen bir script ile diskten gelen
 * bir dosya modele aynı biçimde sunulur, böylece prompt davranışı hedef
 * değiştiğinde sapmaz.
 */
export function formatWorkspaceContext(files) {
    if (files.length === 0)
        return "";
    return files
        .map((file) => {
        const fence = "```";
        const lang = file.language ?? "";
        return `${fence}${lang} path=${file.path}\n${file.content}\n${fence}`;
    })
        .join("\n\n");
}
//# sourceMappingURL=base.js.map