#!/usr/bin/env node
import { Command } from "commander";
import { registerAgentCommand, registerChatCommand, } from "../src/commands/agent.js";
import { registerAuthCommand } from "../src/commands/auth.js";
import { registerStatusCommand } from "../src/commands/status.js";
import { isOnboardingNeeded, runOnboarding } from "../src/onboarding/setup.js";
import { checkMembershipStatus } from "../src/membership/manager.js";
import { ProviderError } from "../src/providers/base.js";
import { MissingKeyError, NoDefaultProviderError, } from "../src/providers/index.js";
import { glyph, theme } from "../src/ui/theme.js";
import { UsageError } from "../src/utils/errors.js";
import { PathEscapeError } from "../src/utils/files.js";
import { VERSION } from "../src/version.js";
/** Hata çıktısı stderr'e gider; stdout boru hattında temiz kalsın. */
function errorOut(text) {
    process.stderr.write(text + "\n");
}
const program = new Command();
program
    .name("onlycli")
    .description("BYOK AI agent CLI — kendi API key'inle terminalden kod yazdır, düzelt.")
    .version(VERSION, "-v, --version", "sürümü göster")
    .showHelpAfterError("(yardım için: onlycli --help)");
registerAuthCommand(program);
registerAgentCommand(program);
registerStatusCommand(program);
// Setup command
program
    .command('setup')
    .description('Re-run onboarding setup (get new membership, configure API keys)')
    .action(async () => {
    await runOnboarding();
});
// Varsayılan komut en sonda kaydedilir; diğer komut adları önce eşleşsin.
registerChatCommand(program);
program.addHelpText("after", `
Örnekler:
  $ onlycli                                    # interaktif sohbet
  $ onlycli auth add --provider anthropic
  $ onlycli auth list
  $ onlycli agent "bu fonksiyondaki off-by-one hatasını bul" -f src/utils.ts
  $ onlycli agent "README'ye kurulum bölümü ekle" --scan
  $ onlycli status                             # üyelik durumu
  $ onlycli /mcp roblox-studio                 # Roblox Studio'ya bağlan

Sohbet içi komutlar:

  /help  /cd  /pwd  /ls  /file  /files  /unfile  /scan  /clear
  /provider  /model  /baseurl  /auto  /web  /mcp  /status  /version  /cls  /exit

MCP Engines:
  🎮 roblox-studio  - Full Roblox Studio integration
  🤖 godot          - Coming soon
  🎯 unity          - Planned
  ⚡ unreal         - Planned

Web erişimi:
  Ajan varsayılan olarak web'de arama yapıp sayfa okuyabilir (--no-web ile kapatın).
  Anahtar gerekmez; anahtarsız DuckDuckGo yolu kullanılır. Brave veya Tavily
  anahtarı eklerseniz sonuçlar daha güvenilir olur.

Ortam değişkenleri:
  ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY  — kayıtlı key'lerin yerine kullanılır.
  OPENAI_BASE_URL                                   — OpenAI uyumlu uç noktayı değiştirir.
  BRAVE_API_KEY, TAVILY_API_KEY                     — web arama anahtarları (opsiyonel).

`);
// Komutu çalıştır
try {
    // Check if command is 'setup' - skip membership validation
    const isSetupCommand = process.argv.includes('setup');
    // İlk kurulum check
    if (await isOnboardingNeeded() || isSetupCommand) {
        await runOnboarding();
        process.exit(0);
    }
    else {
        // Membership validation (silent)
        try {
            const status = await checkMembershipStatus();
            if (!status.valid && status.daysLeft === 0) {
                errorOut(problem('Your membership has expired.'));
                errorOut(theme.muted('  Run: onlycli setup (to get a new free trial)'));
                process.exit(3);
            }
        }
        catch {
            // Silently ignore validation errors on startup
        }
    }
    await program.parseAsync(process.argv);
}
catch (error) {
    fail(error);
}
/** Hataları kullanıcıya anlamlı şekilde gösterir; stack trace'i yalnızca DEBUG'ta. */
function fail(error) {
    if (error instanceof ProviderError) {
        if (error.kind === "aborted") {
            errorOut(theme.muted(`\n${glyph.cross} İptal edildi.`));
            process.exit(130);
        }
        errorOut(problem(error.userMessage));
        debug(error);
        process.exit(1);
    }
    if (error instanceof UsageError ||
        error instanceof PathEscapeError ||
        error instanceof MissingKeyError ||
        error instanceof NoDefaultProviderError) {
        errorOut(problem(error.message));
        process.exit(2);
    }
    // Inquirer, Ctrl+C'de ExitPromptError fırlatır.
    if (error instanceof Error && error.name === "ExitPromptError") {
        errorOut(theme.muted(`\n${glyph.cross} İptal edildi.`));
        process.exit(130);
    }
    if (isNotFoundError(error)) {
        errorOut(problem(`Dosya bulunamadı: ${error.path}`));
        process.exit(2);
    }
    errorOut(problem(`Beklenmeyen hata: ${error instanceof Error ? error.message : String(error)}`));
    debug(error);
    process.exit(1);
}
/** Hata mesajını tek biçimde sarar: boş satır + kırmızı işaret + metin. */
function problem(message) {
    return `\n${theme.error(glyph.cross)} ${theme.text(message)}`;
}
function debug(error) {
    if (process.env.ONLYCLI_DEBUG && error instanceof Error) {
        errorOut(theme.frame(error.stack ?? ""));
    }
    else {
        errorOut(theme.muted("  Ayrıntı için ONLYCLI_DEBUG=1 ile tekrar çalıştırın."));
    }
}
function isNotFoundError(error) {
    return (error instanceof Error &&
        error.code === "ENOENT" &&
        typeof error.path === "string");
}
//# sourceMappingURL=onlycli.js.map