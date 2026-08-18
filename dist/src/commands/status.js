/**
 * `onlycli status` - Show membership and connection status
 */
import { checkMembershipStatus } from '../membership/manager.js';
import { printBox, printEngine } from '../onboarding/ascii.js';
import { getAllEngines } from '../engines/registry.js';
import * as ui from '../ui/components.js';
import { theme } from '../ui/theme.js';
export function registerStatusCommand(program) {
    program
        .command('status')
        .description('Show membership and engine status')
        .action(async () => {
        await runStatus();
    });
}
async function runStatus() {
    ui.blank();
    ui.header('OnlyCLI Status');
    ui.blank();
    // Membership status
    try {
        const status = await checkMembershipStatus();
        if (!status.valid) {
            ui.failure('❌ No active membership');
            ui.hint('Run: onlycli setup');
            ui.blank();
            return;
        }
        const typeLabel = status.type === 'premium' ? '👑 Premium' : '🆓 Free';
        const daysColor = status.daysLeft <= 3 ? theme.error : theme.ok;
        printBox([
            `${typeLabel} Membership - ${daysColor(status.daysLeft + ' days left')}`,
            '',
            'Features:',
            status.features.robloxStudio ? '  ✓ Roblox Studio' : '  ✗ Roblox Studio',
            status.features.godot ? '  ✓ Godot Engine' : '  ✗ Godot Engine',
            status.features.unity ? '  ✓ Unity' : '  ✗ Unity',
            status.features.unreal ? '  ✓ Unreal Engine' : '  ✗ Unreal Engine',
        ]);
        if (status.daysLeft <= 3) {
            ui.warn(`Your membership expires in ${status.daysLeft} days!`);
            ui.hint('Upgrade to premium for unlimited access');
            ui.blank();
        }
    }
    catch (error) {
        ui.failure(`Failed to check status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        ui.blank();
        return;
    }
    // Engine status
    ui.rule('Available Engines');
    ui.blank();
    const engines = getAllEngines();
    for (const engine of engines) {
        printEngine(engine.displayName, engine.status, engine.icon);
    }
    ui.blank();
    ui.hint('Connect to an engine: onlycli /mcp <engine>');
    ui.blank();
}
//# sourceMappingURL=status.js.map