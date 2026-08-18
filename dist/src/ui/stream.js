/**
 * Akış görünümü: model yanıtını yazarken `onlycli:write` bloklarını gizler.
 *
 * Önceki davranışta dosyanın tam içeriği iki kez ekrana geliyordu — bir kez
 * akış sırasında ham blok olarak, bir kez de onay ekranındaki diff'te. Uzun
 * dosyalarda bu, diff'i ekranın dışına itiyordu. Artık akış sırasında blok
 * yerine tek satırlık bir özet gösteriyoruz; asıl içerik yalnızca diff'te
 * görünüyor.
 */
import { MarkdownRenderer } from "./markdown.js";
import { glyph, theme } from "./theme.js";
const WRITE_HEADER = /^```onlycli:write\s+path=(.+?)\s*$/;
const FENCE_CLOSE = "```";
export class StreamView {
    buffer = "";
    markdown;
    write;
    /** Gizlenen blok içindeyken satır sayısını sayar. */
    inWrite = false;
    writePath = "";
    writeLines = 0;
    constructor(options = {}) {
        this.write = options.write ?? ((text) => process.stdout.write(text));
        this.markdown = new MarkdownRenderer({ write: this.write });
    }
    push(chunk) {
        this.buffer += chunk;
        let index = this.buffer.indexOf("\n");
        while (index !== -1) {
            const line = this.buffer.slice(0, index);
            this.buffer = this.buffer.slice(index + 1);
            this.handleLine(line);
            index = this.buffer.indexOf("\n");
        }
    }
    end() {
        if (this.buffer.length > 0) {
            const line = this.buffer;
            this.buffer = "";
            this.handleLine(line);
        }
        if (this.inWrite) {
            // Blok kapanmadan akış bitti; yine de kullanıcıya ne olduğunu söyle.
            this.finishWrite(false);
        }
        this.markdown.end();
    }
    handleLine(raw) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (this.inWrite) {
            if (line.trimEnd() === FENCE_CLOSE) {
                this.finishWrite(true);
                return;
            }
            this.writeLines++;
            return;
        }
        const header = WRITE_HEADER.exec(line.trim());
        if (header?.[1]) {
            // Markdown tamponunu boşalt, yoksa özet satırı yarım satırın içine düşer.
            this.markdown.end();
            this.inWrite = true;
            this.writePath = header[1].trim().replace(/^["']|["']$/g, "");
            this.writeLines = 0;
            return;
        }
        this.markdown.push(line + "\n");
    }
    finishWrite(closed) {
        const label = closed
            ? `${this.writeLines} satır hazırlandı`
            : `${this.writeLines} satır (blok tamamlanmadı)`;
        this.write(`${theme.accentDeep(glyph.diamond)} ${theme.accent(this.writePath)} ${theme.frame(glyph.dot)} ${theme.muted(label)}\n`);
        this.inWrite = false;
        this.writePath = "";
        this.writeLines = 0;
    }
}
//# sourceMappingURL=stream.js.map