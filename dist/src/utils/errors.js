/** Kullanıcı hatası: stack trace basmadan temiz mesaj göstermek için. */
export class UsageError extends Error {
    constructor(message) {
        super(message);
        this.name = "UsageError";
    }
}
//# sourceMappingURL=errors.js.map