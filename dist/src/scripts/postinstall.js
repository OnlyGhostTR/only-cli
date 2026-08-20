/**
 * Global kurulumdan sonra `onlycli` komutunun gerçekten çağrılabilir olup
 * olmadığını denetler.
 *
 * NEDEN VAR: `npm install -g onlycli` paketi doğru kurar ve bin link'ini
 * oluşturur, ama npm'in global bin dizinini kullanıcının PATH'ine eklemez. O
 * dizin PATH'te yoksa kurulum "added N packages" diyerek başarıyla biter,
 * ardından kabuk `command not found: onlycli` der. Kullanıcı açısından bu,
 * paketin bozuk olmasından ayırt edilemez. pnpm'de aynı sorun görülmez, çünkü
 * `pnpm setup` kendi bin dizinini kabuk profiline yazar.
 *
 * TASARIM KISITLARI (hepsi ölçülerek doğrulandı):
 *
 * 1. npm, yaşam döngüsü scriptlerinin stdout'unu varsayılan olarak yutar
 *    (yalnızca `--foreground-scripts` ile görünür). Bu yüzden uyarı doğrudan
 *    terminale (`/dev/tty`, Windows'ta `CONOUT$`) yazılıyor; oraya
 *    yazılamıyorsa stderr'e düşülüyor.
 * 2. Bir postinstall sıfır dışı kodla çıkarsa `npm install` tamamen başarısız
 *    olur. Bu script hiçbir koşulda fırlatmaz ve daima 0 ile çıkar; ayrıca
 *    package.json tarafında `|| exit 0` ile ikinci bir emniyet var.
 * 3. Bin link'leri postinstall çalıştığı anda mevcut oluyor, dolayısıyla
 *    link'in varlığı burada güvenle kontrol edilebiliyor.
 * 4. Yerel bağımlılık olarak kurulduğunda (`npm_config_global` yok) tamamen
 *    sessiz kalır; başkasının build çıktısını kirletmemesi gerekir.
 *
 * Kabuk profil dosyasına kendiliğinden yazmaz. Yanlış dosyayı seçmek veya
 * bozuk bir satır eklemek kullanıcının kabuğunu açılamaz hale getirebilir ve
 * bunu geri almak kolay değil. `ONLYCLI_FIX_PATH=1` verilirse satırı ekler.
 */
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeSync, } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
/** npm'in bin link'lerini bıraktığı dizin. Windows'ta prefix'in kendisi. */
export function globalBinDir(prefix, platform) {
    return platform === "win32" ? prefix : join(prefix, "bin");
}
/**
 * PATH girdilerini karşılaştırılabilir hale getirir: `~` açılır, ayırıcılar
 * hedef platforma göre tekleştirilir, `.`/`..` sadeleştirilir, sondaki ayırıcı
 * atılır, Windows'ta harf büyüklüğü düşürülür.
 *
 * `node:path`'ın `resolve`/`normalize`'ı burada kullanılamaz: ikisi de
 * çalıştığımız platformun kurallarını uygular, oysa hedef platform parametreyle
 * geliyor. Windows'ta `resolve("/usr/local/bin")` "C:\usr\local\bin" veriyor.
 */
export function normalizeDir(dir, platform, home = homedir()) {
    let value = dir.trim();
    if (value === "")
        return "";
    // Kabuk profillerinde PATH girdileri tırnak içinde yazılabiliyor.
    if (value.length > 1 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1).trim();
        if (value === "")
            return "";
    }
    if (value === "~") {
        value = home;
    }
    else if (value.startsWith("~/") || value.startsWith("~\\")) {
        value = home + "/" + value.slice(2);
    }
    const isWindows = platform === "win32";
    // Windows her iki ayırıcıyı da kabul eder; POSIX'te "\" geçerli bir dosya adı
    // karakteri olduğu için dokunulmaz.
    if (isWindows)
        value = value.replace(/\//g, "\\");
    const sep = isWindows ? "\\" : "/";
    // Kök öneki (POSIX "/", Windows "C:\" veya UNC "\\") sadeleştirmeden korunur.
    let prefix = "";
    if (isWindows) {
        const drive = /^([A-Za-z]:)(\\?)/.exec(value);
        if (value.startsWith("\\\\")) {
            prefix = "\\\\";
            value = value.slice(2);
        }
        else if (drive) {
            prefix = drive[1] + (drive[2] ? "\\" : "");
            value = value.slice(drive[0].length);
        }
    }
    else if (value.startsWith("/")) {
        prefix = "/";
        value = value.slice(1);
    }
    const segments = [];
    for (const part of value.split(isWindows ? /\\+/ : /\/+/)) {
        if (part === "" || part === ".")
            continue;
        if (part === "..") {
            // Kökün üstüne çıkılamaz; göreli yolda ".." korunur.
            if (segments.length > 0 && segments[segments.length - 1] !== "..") {
                segments.pop();
            }
            else if (prefix === "") {
                segments.push("..");
            }
            continue;
        }
        segments.push(part);
    }
    const joined = prefix + segments.join(sep);
    // Yalnızca kök kaldıysa ("/" veya "C:\") olduğu gibi bırakılır.
    const result = joined === "" ? value : joined;
    return isWindows ? result.toLowerCase() : result;
}
/** Verilen dizin PATH'te var mı? */
export function isOnPath(dir, pathValue, platform, home = homedir()) {
    if (!pathValue)
        return false;
    const target = normalizeDir(dir, platform, home);
    if (target === "")
        return false;
    // Windows'ta PATH ayırıcısı ';' — POSIX'te ':'. node:path'ın `delimiter`
    // değeri çalıştığımız platformu yansıtır, oysa hedef platform parametreyle
    // geliyor (testler her ikisini de kuruyor).
    const sep = platform === "win32" ? ";" : ":";
    return pathValue
        .split(sep)
        .some((entry) => normalizeDir(entry, platform, home) === target);
}
/** Kullanıcının kabuğuna göre profil dosyası; tanınmayan kabukta null. */
export function shellProfile(shell, platform, home = homedir()) {
    if (platform === "win32")
        return null;
    const name = (shell ?? "").split("/").pop() ?? "";
    if (name === "zsh") {
        return {
            name: "zsh",
            file: join(home, ".zshrc"),
            line: (dir) => `export PATH="${dir}:$PATH"`,
        };
    }
    if (name === "bash") {
        // Linux'ta etkileşimli kabuk .bashrc okur; macOS'ta Terminal login kabuğu
        // açtığı için .bash_profile gerekir. Platforma göre doğru olanı veriyoruz.
        return {
            name: "bash",
            file: join(home, platform === "darwin" ? ".bash_profile" : ".bashrc"),
            line: (dir) => `export PATH="${dir}:$PATH"`,
        };
    }
    if (name === "fish") {
        return {
            name: "fish",
            file: join(home, ".config", "fish", "config.fish"),
            // fish'te PATH bir liste; fish_add_path yineleme yapmadan başa ekler.
            line: (dir) => `fish_add_path ${dir}`,
        };
    }
    return null;
}
/**
 * Uyarı metni. Satır listesi döndürüyor ki test edilebilsin ve yazma
 * hedefinden (tty/stderr) bağımsız kalsın.
 */
export function buildWarning(binDir, platform, shell, home = homedir()) {
    const lines = [
        "",
        "OnlyCLI is installed, but the `onlycli` command is not on your PATH yet.",
        "",
        `  installed to : ${binDir}`,
        "  that directory is not in PATH, so the shell cannot find the command",
        "",
    ];
    if (platform === "win32") {
        lines.push("Add it to PATH, then open a new terminal:");
        lines.push("");
        lines.push(`  setx PATH "%PATH%;${binDir}"`);
    }
    else {
        const profile = shellProfile(shell, platform, home);
        if (profile) {
            lines.push(`Add it to PATH (${profile.name}):`);
            lines.push("");
            lines.push(`  echo '${profile.line(binDir)}' >> ${profile.file}`);
            lines.push(`  source ${profile.file}`);
            lines.push("");
            lines.push("Or let the installer write that line for you:");
            lines.push("");
            lines.push("  ONLYCLI_FIX_PATH=1 npm install -g onlycli");
        }
        else {
            lines.push("Add it to PATH, then reopen the terminal:");
            lines.push("");
            lines.push(`  export PATH="${binDir}:$PATH"`);
        }
    }
    lines.push("");
    lines.push("Until then the full path works:");
    lines.push("");
    lines.push(`  ${join(binDir, "onlycli")} --version`);
    lines.push("");
    return lines;
}
/**
 * Terminale yazar. npm yaşam döngüsü scriptlerinin stdout'unu yuttuğu için
 * `console.log` burada işe yaramıyor; tty'ye doğrudan yazmak görünürlüğün tek
 * güvenilir yolu. Terminal yoksa (CI, boru hattı, Docker build) stderr'e düşer.
 */
function writeToTerminal(text) {
    const device = process.platform === "win32" ? "\\\\.\\CONOUT$" : "/dev/tty";
    try {
        const fd = openSync(device, "w");
        try {
            writeSync(fd, text);
        }
        finally {
            closeSync(fd);
        }
        return;
    }
    catch {
        // Terminal açılamadı; aşağıdaki stderr yoluna düş.
    }
    try {
        process.stderr.write(text);
    }
    catch {
        // Yazamıyorsak sessiz kal; kurulumu bozmak buna değmez.
    }
}
/**
 * `ONLYCLI_FIX_PATH=1` verildiğinde profil dosyasına PATH satırını ekler.
 * Aynı satır zaten varsa tekrar yazmaz — her kurulumda birikmemesi gerekir.
 */
export function fixPath(binDir, platform, shell, home = homedir()) {
    const profile = shellProfile(shell, platform, home);
    if (!profile)
        return null;
    const line = profile.line(binDir);
    try {
        if (existsSync(profile.file)) {
            const current = readFileSync(profile.file, "utf8");
            if (current.includes(line)) {
                return [
                    "",
                    `OnlyCLI: ${profile.file} already has the PATH line.`,
                    `Open a new terminal, or run: source ${profile.file}`,
                    "",
                ];
            }
        }
        appendFileSync(profile.file, `\n# Added by the onlycli installer\n${line}\n`, "utf8");
        return [
            "",
            `OnlyCLI: added npm's global bin directory to ${profile.file}`,
            "",
            `  ${line}`,
            "",
            `Run \`source ${profile.file}\` or open a new terminal, then: onlycli`,
            "",
        ];
    }
    catch (error) {
        return [
            "",
            `OnlyCLI: could not write to ${profile.file}`,
            `  ${error instanceof Error ? error.message : String(error)}`,
            "",
            "Add this line yourself, then reopen the terminal:",
            "",
            `  ${line}`,
            "",
        ];
    }
}
export function main() {
    if (process.env["ONLYCLI_SKIP_POSTINSTALL"] === "1")
        return;
    // Yerel bağımlılık kurulumunda hiçbir şey yapma; başkasının build çıktısını
    // kirletmemeli.
    if (process.env["npm_config_global"] !== "true")
        return;
    const prefix = process.env["npm_config_prefix"] ??
        process.env["npm_config_global_prefix"] ??
        "";
    if (prefix === "")
        return;
    const platform = process.platform;
    const binDir = globalBinDir(prefix, platform);
    // Link gerçekten oluşmadıysa sorun PATH değil; yanlış yöne yönlendirmeyelim.
    const linkExists = existsSync(join(binDir, "onlycli")) ||
        existsSync(join(binDir, "onlycli.cmd"));
    if (!linkExists)
        return;
    // Windows'ta ortam değişkeni adı büyük/küçük harf duyarsız; Node her ikisini
    // de görebiliyor, ikisine de bakıyoruz.
    const pathValue = process.env["PATH"] ?? process.env["Path"];
    if (isOnPath(binDir, pathValue, platform))
        return; // Her şey yolunda, sessiz kal.
    const shell = process.env["SHELL"];
    if (process.env["ONLYCLI_FIX_PATH"] === "1") {
        const result = fixPath(binDir, platform, shell);
        if (result) {
            writeToTerminal(result.join("\n") + "\n");
            return;
        }
    }
    writeToTerminal(buildWarning(binDir, platform, shell).join("\n") + "\n");
}
// Yalnızca doğrudan çalıştırıldığında devreye girer; testler fonksiyonları
// import eder. Hiçbir hata kurulumu düşürmemeli: bir postinstall sıfır dışı
// kodla çıkarsa `npm install -g` tümden başarısız olur.
if (process.argv[1]?.endsWith("postinstall.js")) {
    try {
        main();
    }
    catch {
        // Yut. Bu script bir kolaylık; kurulumun başarısını belirlememeli.
    }
}
//# sourceMappingURL=postinstall.js.map