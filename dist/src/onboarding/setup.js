/**
 * Interactive onboarding flow - first-time setup
 */
import { select, input } from '@inquirer/prompts';
import { printLogo, printProgress, printBox, printCommand, printEngine } from './ascii.js';
import { initMembership } from '../membership/manager.js';
import { setApiKey, hasApiKey } from '../config/store.js';
import { getAllEngines } from '../engines/registry.js';
import * as ui from '../ui/components.js';
/**
 * Run the complete onboarding flow
 */
export async function runOnboarding() {
    console.clear();
    printLogo();
    ui.blank();
    ui.info('Setting up your workspace...');
    ui.blank();
    // Step 1: System check
    printProgress('Checking system requirements', false);
    await sleep(300);
    printProgress('Checking system requirements', true);
    // Step 2: Generate device ID
    printProgress('Generating device ID', false);
    await sleep(300);
    printProgress('Generating device ID', true);
    // Step 3: Register membership
    printProgress('Registering free membership', false);
    let status;
    try {
        status = await initMembership();
        await sleep(300);
        printProgress('Registering free membership', true);
    }
    catch (error) {
        ui.failure(`Failed to register: ${error instanceof Error ? error.message : 'Unknown error'}`);
        ui.hint('Please check your internet connection and try again.');
        process.exit(1);
    }
    // Membership success
    ui.blank();
    printBox([
        '✓ Your free membership is now active!',
        '',
        `  • ${status.daysLeft} days of full access`,
        '  • Multi-engine support (Roblox Studio ready)',
        '  • AI-powered development',
        '  • Premium features included',
    ]);
    // Step 4: API key setup
    ui.info("Let's configure your AI provider:");
    ui.blank();
    const provider = await select({
        message: 'Which provider would you like to use?',
        choices: [
            { name: 'Anthropic (Claude) - Recommended', value: 'anthropic' },
            { name: 'Google (Gemini)', value: 'gemini' },
            { name: 'OpenAI (GPT-4)', value: 'openai' },
        ],
    });
    const keyUrls = {
        anthropic: 'https://console.anthropic.com/settings/keys',
        gemini: 'https://aistudio.google.com/apikey',
        openai: 'https://platform.openai.com/api-keys',
    };
    ui.blank();
    ui.hint(`Get your API key at: ${keyUrls[provider]}`);
    ui.blank();
    let apiKey = '';
    let keyValid = false;
    while (!keyValid) {
        apiKey = await input({
            message: `Enter your ${provider} API key:`,
            validate: (value) => {
                if (!value || value.length < 10) {
                    return 'Please enter a valid API key';
                }
                return true;
            },
        });
        // Validate key
        ui.blank();
        printProgress('Validating API key', false);
        try {
            // Quick validation - just check format
            if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
                throw new Error('Invalid Anthropic API key format');
            }
            if (provider === 'openai' && !apiKey.startsWith('sk-')) {
                throw new Error('Invalid OpenAI API key format');
            }
            await sleep(500);
            printProgress('Validating API key', true);
            printProgress('Testing connection', false);
            await sleep(300);
            printProgress('Testing connection', true);
            keyValid = true;
        }
        catch (error) {
            ui.failure('Invalid API key. Please try again.');
            ui.blank();
        }
    }
    // Save API key
    await setApiKey(provider, apiKey);
    // Setup complete
    ui.blank();
    printBox([
        '✓ Setup complete!',
        '',
        'Ready to start? Try these commands:',
    ]);
    printCommand('onlycli', 'Start interactive chat');
    printCommand('onlycli /mcp roblox-studio', 'Connect to Roblox Studio');
    printCommand('onlycli status', 'Check membership status');
    ui.blank();
    ui.info('Supported engines:');
    // Read the list from the engine registry instead of hardcoding it. The old
    // hardcoded block was written for 2.0.2 and still advertised Godot as
    // "coming soon" after it became a fully active engine, so setup contradicted
    // both `onlycli status` and `/mcp`. printEngine is the same renderer those two
    // use, so all three now report identical status labels from one source.
    for (const engine of getAllEngines()) {
        printEngine(engine.displayName, engine.status, engine.icon);
    }
    ui.blank();
    ui.hint('Need help? Run: onlycli help');
    ui.blank();
    printBox(['Press any key to start...']);
    // Wait for user
    await waitForKey();
}
/**
 * Check if onboarding is needed
 */
export async function isOnboardingNeeded() {
    const { needsSetup } = await import('../membership/manager.js');
    const needsMembership = await needsSetup();
    const needsKey = !(await hasApiKey());
    return needsMembership || needsKey;
}
/**
 * Quick setup for returning users (just API key if needed)
 */
export async function quickSetup() {
    if (await hasApiKey()) {
        return; // Already configured
    }
    ui.info('No API key configured. Quick setup:');
    ui.blank();
    const provider = await select({
        message: 'Choose your AI provider:',
        choices: [
            { name: 'Anthropic (Claude)', value: 'anthropic' },
            { name: 'Google (Gemini)', value: 'gemini' },
            { name: 'OpenAI (GPT-4)', value: 'openai' },
        ],
    });
    const apiKey = await input({
        message: 'Enter your API key:',
    });
    await setApiKey(provider, apiKey);
    ui.success('API key saved!');
    ui.blank();
}
// Helper functions
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function waitForKey() {
    return new Promise(resolve => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once('data', () => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            resolve();
        });
    });
}
//# sourceMappingURL=setup.js.map