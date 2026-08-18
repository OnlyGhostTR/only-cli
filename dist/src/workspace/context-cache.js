/**
 * Studio proje context cache'i.
 *
 * Problem: Her turda tüm projeyi baştan taramak zaman kaybı ve model bazen
 * farklı context'le çıkarsama yapıyor. Aynı proje için ilk taramayı cache'leyip
 * yalnızca değişen dosyaları yeniden okumak hem hızlandırır hem tutarlılık sağlar.
 *
 * Cache Studio workspace'e özel: disk workspace'te her `scan()` zaten hızlı
 * ve dosya sistemi timestamp'leri güvenilir.
 */
import { createHash } from "node:crypto";
export class ContextCache {
    cache = null;
    /** Cache geçerlilik süresi: 5 dakika. */
    TTL_MS = 5 * 60 * 1000;
    /**
     * Proje için cache var mı ve hâlâ geçerli mi?
     */
    isValid(projectId) {
        if (!this.cache)
            return false;
        if (this.cache.projectId !== projectId)
            return false;
        return Date.now() - this.cache.scannedAt < this.TTL_MS;
    }
    /**
     * Proje taramasını cache'e kaydeder.
     */
    store(projectId, files) {
        const contentHashes = new Map();
        for (const file of files) {
            contentHashes.set(file.path, hashContent(file.content));
        }
        this.cache = {
            projectId,
            scannedAt: Date.now(),
            files,
            contentHashes,
        };
    }
    /**
     * Cache'lenmiş dosya listesini döndürür.
     * Cache geçerli değilse null döner.
     */
    get(projectId) {
        if (!this.isValid(projectId))
            return null;
        return this.cache.files;
    }
    /**
     * Bir dosyanın içeriği değişmiş mi?
     */
    hasChanged(path, newContent) {
        if (!this.cache)
            return true;
        const oldHash = this.cache.contentHashes.get(path);
        if (!oldHash)
            return true;
        return oldHash !== hashContent(newContent);
    }
    /**
     * Tek bir dosyayı cache'te günceller.
     */
    updateFile(file) {
        if (!this.cache)
            return;
        // Var olan dosyayı bul ve güncelle
        const index = this.cache.files.findIndex((f) => f.path === file.path);
        if (index >= 0) {
            this.cache.files[index] = file;
        }
        else {
            // Yeni dosya ekleniyor
            this.cache.files.push(file);
        }
        this.cache.contentHashes.set(file.path, hashContent(file.content));
    }
    /**
     * Bir dosyayı cache'ten kaldırır (silindiğinde).
     */
    removeFile(path) {
        if (!this.cache)
            return;
        this.cache.files = this.cache.files.filter((f) => f.path !== path);
        this.cache.contentHashes.delete(path);
    }
    /**
     * Cache'i tamamen temizler.
     */
    clear() {
        this.cache = null;
    }
    /**
     * Kaç dosya cache'lenmiş?
     */
    get size() {
        return this.cache?.files.length ?? 0;
    }
    /**
     * Scan sonrası eski cache'ten silinen dosyaları temizler.
     * Yeni scanned dosya listesiyle karşılaştırıp artık mevcut olmayan dosyaları kaldırır.
     */
    removeDeletedFiles(currentFiles) {
        if (!this.cache)
            return;
        const currentPaths = new Set(currentFiles.map((f) => f.path));
        const deletedFiles = this.cache.files.filter((f) => !currentPaths.has(f.path));
        for (const file of deletedFiles) {
            this.removeFile(file.path);
        }
    }
}
function hashContent(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}
// Global singleton: Studio workspace instance'ları arasında paylaşılır
export const studioContextCache = new ContextCache();
//# sourceMappingURL=context-cache.js.map