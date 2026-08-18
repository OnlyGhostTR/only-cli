/**
 * Çok satırlı girdi kuralları.
 *
 * Terminal, Enter ile Shift+Enter'ı ayırt etmez: ikisi de aynı baytı (CR)
 * gönderir. Tuş birleşimini yakalayabilmek kabuk emülatörünün gelişmiş klavye
 * protokollerini (kitty / modifyOtherKeys) desteklemesine ve açık olmasına
 * bağlıdır — cmd.exe ve PowerShell'de bu yok. Bu yüzden çok satırlı girdiyi
 * tuşa değil, satırın kendisine bakan iki kurala bağlıyoruz; bunlar her
 * terminalde ve boru hattında aynı çalışır.
 *
 * 1. Satır sonunda tek `\`  → istek devam ediyor, sonraki satır eklenir.
 * 2. Tek başına `"""`       → kapanış `"""` görülene kadar her şey metindir.
 *
 * Saf fonksiyonlar hâlinde tutuluyorlar; girdi okuma katmanından bağımsız
 * test edilebilmeleri, kuralın kendisinin doğruluğunu okuma döngüsünden
 * ayırıyor.
 */
/** Blok modunu açan ve kapatan işaret. */
export const BLOCK_DELIMITER = '"""';
/**
 * Satır sonundaki devam işaretini çözer.
 *
 * `\\` ile bitiren satır devam etmez: kullanıcı gerçekten ters bölü yazmak
 * istiyordur (Windows yolları buna sık düşer, ör. `C:\src\`). Kaçış olmadan
 * yolun sonundaki bölü sessizce satırı birleştirir ve istek bozulurdu.
 */
export function parseContinuation(line) {
    if (line.endsWith("\\\\")) {
        // Kaçırılmış bölü: bir tanesini düşür, tek bölü metinde kalsın.
        return { text: line.slice(0, -1), continues: false };
    }
    if (line.endsWith("\\")) {
        // Devam eden satırın sonundaki boşluk, birleşince araya çift boşluk
        // sokardı; satır sonunu temizliyoruz.
        return { text: line.slice(0, -1).trimEnd(), continues: true };
    }
    return { text: line, continues: false };
}
/** Satır yalnızca blok işaretinden mi oluşuyor? */
export function isBlockDelimiter(line) {
    return line.trim() === BLOCK_DELIMITER;
}
/**
 * Toplanan satırları tek isteğe çevirir.
 *
 * Baştaki ve sondaki boş satırlar atılır — blok modunda kullanıcı işaretlerden
 * sonra sıklıkla boş satır bırakır ve bunlar isteğe bir şey katmaz. Aradaki boş
 * satırlar korunur, çünkü paragraf ayrımı taşıyorlar.
 */
export function joinLines(lines) {
    const joined = lines.join("\n");
    return joined.replace(/^\n+/, "").replace(/\s+$/, "");
}
//# sourceMappingURL=multiline.js.map