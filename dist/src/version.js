/**
 * Tek sürüm kaynağı.
 *
 * Daha önce sürüm üç ayrı yerde elle yazılıydı (`package.json`, `--version`
 * çıktısı, üyelik isteklerinin User-Agent'ı) ve üçü birbirinden kaymıştı.
 * Sunucu `User-Agent: OnlyCLI/<sürüm>` değerine bakıp minimum sürüm dayattığı
 * için bu kayma sessiz 426 hatalarına yol açabiliyordu; artık hepsi buradan
 * okuyor.
 *
 * Değiştirirken `package.json` içindeki `version` alanını da aynı değere
 * getirin.
 */
export const VERSION = "2.0.5";
/** Üyelik sunucusunun istemciyi tanıması için kullanılan User-Agent. */
export const USER_AGENT = `OnlyCLI/${VERSION}`;
//# sourceMappingURL=version.js.map