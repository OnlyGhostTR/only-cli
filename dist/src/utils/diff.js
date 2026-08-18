import { createTwoFilesPatch } from "diff";
/**
 * Unified diff üretir. Kullanıcı onay vermeden dosyaya hiçbir şey yazılmadığı
 * için bu çıktı, onay ekranının tek bilgi kaynağı.
 */
export function buildDiff(path, before, after) {
    // CR'leri yalnızca gösterim için atıyoruz: patch satırlara \n ile bölündüğü
    // için CRLF dosyalarda her satırın sonunda kalan \r terminalde fazladan boş
    // satır olarak görünüyor. Diske yazılan içerik bundan etkilenmez.
    return createTwoFilesPatch(`a/${path}`, `b/${path}`, stripCr(before), stripCr(after), undefined, undefined, { context: 3 });
}
function stripCr(content) {
    return content.replace(/\r\n/g, "\n");
}
export function diffStats(patch) {
    let added = 0;
    let removed = 0;
    for (const line of patch.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++"))
            added++;
        else if (line.startsWith("-") && !line.startsWith("---"))
            removed++;
    }
    return { added, removed };
}
// Diff'in renklendirilmesi ve satır numaralandırması artık ui/components.ts
// içindeki renderDiff'te; burada yalnızca ham patch üretimi kalıyor.
export function hasChanges(before, after) {
    return before !== after;
}
//# sourceMappingURL=diff.js.map