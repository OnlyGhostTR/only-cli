/**
 * Local membership storage - stores key and device ID
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
const CONFIG_DIR = join(homedir(), '.onlycli');
const MEMBERSHIP_FILE = join(CONFIG_DIR, 'membership.json');
/**
 * Save membership key to local storage
 */
export async function saveMembership(membership) {
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(MEMBERSHIP_FILE, JSON.stringify(membership, null, 2), 'utf-8');
}
/**
 * Load membership key from local storage
 */
export async function loadMembership() {
    try {
        const data = await readFile(MEMBERSHIP_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        const expiresAt = typeof parsed.expiresAt === 'number'
            ? parsed.expiresAt
            : Number.isFinite(Number(parsed.expiresAt))
                ? Number(parsed.expiresAt)
                : Date.parse(parsed.expiresAt);
        return {
            ...parsed,
            expiresAt,
        };
    }
    catch (error) {
        // File doesn't exist or invalid JSON
        return null;
    }
}
/**
 * Check if membership exists locally
 */
export async function hasMembership() {
    const membership = await loadMembership();
    return membership !== null;
}
/**
 * Clear stored membership (for testing/reset)
 */
export async function clearMembership() {
    try {
        const { unlink } = await import('node:fs/promises');
        await unlink(MEMBERSHIP_FILE);
    }
    catch {
        // File doesn't exist, that's fine
    }
}
//# sourceMappingURL=store.js.map