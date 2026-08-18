/**
 * İnteraktif oturumun durumu.
 *
 * Sohbet geçmişi, çalışma dizini ve sabitlenmiş dosyalar burada tutulur.
 * UI'dan ve dosya sisteminden bağımsızdır; bu sayede dizin değiştirme ve
 * geçmiş budama davranışı doğrudan test edilebilir.
 */
import { resolve } from "node:path";
/** Modele gönderilen geçmişteki üst sınır (karakter). Aşılırsa en eski turlar düşer. */
const MAX_HISTORY_CHARS = 120_000;
/** Tutulacak azami mesaj sayısı (kullanıcı + asistan). */
const MAX_HISTORY_MESSAGES = 40;
export class Session {
    /** Dosya yollarının çözümlendiği kök; /cd ile değişir. */
    cwd;
    /**
     * Aktif sağlayıcı. Serbest metin değil ProviderId: /baseurl gibi komutlar
     * bu değere göre yetenek kontrolü yapıyor, tip daralması gerekiyor.
     */
    providerId;
    providerLabel;
    model;
    /** true ise dosya değişiklikleri onay sorulmadan uygulanır. */
    autoApprove;
    /**
     * true ise model arama/sayfa getirme araçlarını kullanabilir.
     *
     * Varsayılan açık: güncel bilgi gerektiren soruların sessizce eski bilgiyle
     * yanıtlanması, ağ isteğinden daha büyük bir sorun. Kapatmak isteyen
     * /web off ile kapatır.
     */
    webEnabled;
    /**
     * Active MCP connection to game engine (if any)
     */
    mcpConnection; // MCPConnection type from engines/types.ts
    history = [];
    /** Her turda context'e eklenecek, kullanıcının sabitlediği yollar. */
    pinned = new Set();
    constructor(init) {
        this.cwd = resolve(init.cwd);
        this.providerId = init.providerId;
        this.providerLabel = init.providerLabel;
        this.model = init.model;
        this.autoApprove = init.autoApprove === true;
        this.webEnabled = init.web !== false;
        this.mcpConnection = null;
    }
    /** Dizini değiştirir. Yolun geçerliliği çağıran tarafta doğrulanır. */
    changeDirectory(absolutePath) {
        this.cwd = resolve(absolutePath);
    }
    pin(relativePath) {
        this.pinned.add(relativePath);
    }
    unpin(relativePath) {
        return this.pinned.delete(relativePath);
    }
    get pinnedFiles() {
        return [...this.pinned];
    }
    clearPinned() {
        this.pinned.clear();
    }
    addUserMessage(content) {
        this.history.push({ role: "user", content });
        this.trim();
    }
    addAssistantMessage(content) {
        this.history.push({ role: "assistant", content });
        this.trim();
    }
    /** Son eklenen mesajı geri alır; istek başarısız olduğunda geçmişi kirletmemek için. */
    dropLastMessage() {
        this.history.pop();
    }
    get messages() {
        return [...this.history];
    }
    get turnCount() {
        return this.history.filter((message) => message.role === "user").length;
    }
    /** Sohbeti sıfırlar; dizin, sağlayıcı ve model korunur. */
    resetHistory() {
        this.history.length = 0;
    }
    /**
     * Geçmişi sınırlar içinde tutar. Budama her zaman en eski turdan başlar ve
     * ilk mesajın "user" olmasını korur — sağlayıcılar asistanla başlayan
     * geçmişi reddedebilir.
     */
    trim() {
        while (this.history.length > MAX_HISTORY_MESSAGES) {
            this.history.shift();
        }
        while (this.totalChars() > MAX_HISTORY_CHARS && this.history.length > 1) {
            this.history.shift();
        }
        while (this.history.length > 0 && this.history[0]?.role !== "user") {
            this.history.shift();
        }
    }
    totalChars() {
        let total = 0;
        for (const message of this.history)
            total += message.content.length;
        return total;
    }
}
//# sourceMappingURL=session.js.map