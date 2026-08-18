/**
 * ASCII art and branded UI elements
 */
import { theme } from '../ui/theme.js';
export const LOGO = `
   ██████╗ ███╗   ██╗██╗  ██╗   ██╗ ██████╗██╗     ██╗
  ██╔═══██╗████╗  ██║██║  ╚██╗ ██╔╝██╔════╝██║     ██║
  ██║   ██║██╔██╗ ██║██║   ╚████╔╝ ██║     ██║     ██║
  ██║   ██║██║╚██╗██║██║    ╚██╔╝  ██║     ██║     ██║
  ╚██████╔╝██║ ╚████║███████╗██║   ╚██████╗███████╗██║
   ╚═════╝ ╚═╝  ╚═══╝╚══════╝╚═╝    ╚═════╝╚══════╝╚═╝
`;
export const LOGO_SMALL = `
  ╔═══════════════════════════════════════╗
  ║           ⚡ OnlyCLI v2.0 ⚡           ║
  ╚═══════════════════════════════════════╝
`;
/**
 * Print the main logo with tagline
 */
export function printLogo(tagline = 'AI-Powered Game Development Tool') {
    console.log(theme.accent(LOGO));
    console.log(theme.frame('┌─────────────────────────────────────────────────────┐'));
    console.log(theme.frame('│') + '  Welcome to OnlyCLI v2.0                            ' + theme.frame('│'));
    console.log(theme.frame('│') + `  ${tagline.padEnd(51)}` + theme.frame('│'));
    console.log(theme.frame('└─────────────────────────────────────────────────────┘'));
    console.log();
}
/**
 * Print a box with content
 */
export function printBox(lines) {
    const maxLen = Math.max(...lines.map(l => l.length));
    const width = Math.min(maxLen + 4, 80);
    console.log(theme.frame('━'.repeat(width)));
    for (const line of lines) {
        console.log(theme.frame('│ ') + theme.text(line.padEnd(width - 4)) + theme.frame(' │'));
    }
    console.log(theme.frame('━'.repeat(width)));
    console.log();
}
/**
 * Print success message with checkmark
 */
export function printSuccess(message) {
    console.log(theme.ok(`✓ ${message}`));
}
/**
 * Print progress item
 */
export function printProgress(message, done = false) {
    if (done) {
        console.log(theme.ok(`→ ${message}... ✓`));
    }
    else {
        console.log(theme.muted(`→ ${message}...`));
    }
}
/**
 * Print section header
 */
export function printSection(title) {
    console.log();
    console.log(theme.accent(`▸ ${title}`));
    console.log();
}
/**
 * Print command example
 */
export function printCommand(command, description) {
    console.log(`  ${theme.accentSoft(command.padEnd(30))}  ${theme.muted(description)}`);
}
/**
 * Print engine status
 */
export function printEngine(name, status, icon) {
    const statusColors = {
        active: theme.ok,
        beta: theme.accent,
        'coming-soon': theme.muted,
    };
    const statusLabels = {
        active: '✓ Active',
        beta: '🔄 Beta',
        'coming-soon': '📋 Coming Soon',
    };
    const color = statusColors[status] || theme.text;
    const label = statusLabels[status] || status;
    console.log(`  ${icon} ${theme.text(name.padEnd(20))} ${color(label)}`);
}
//# sourceMappingURL=ascii.js.map