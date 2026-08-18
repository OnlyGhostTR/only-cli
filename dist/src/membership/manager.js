/**
 * Membership manager - handles registration, validation, and status
 */
import { generateDeviceId, getMachineInfo } from './device.js';
import { registerMembership, validateMembership, fetchAIRules } from './api.js';
import { saveMembership, loadMembership, hasMembership } from './store.js';
/**
 * Initialize membership - register if new, validate if existing
 */
export async function initMembership() {
    const deviceId = generateDeviceId();
    const existing = await loadMembership();
    // If no local membership, register new one
    if (!existing) {
        const machineInfo = getMachineInfo();
        const response = await registerMembership({ deviceId, machineInfo });
        const membership = {
            key: response.key,
            type: response.type,
            expiresAt: response.expiresAt,
            deviceId,
            features: {
                robloxStudio: true,
                godot: false,
                unity: false,
                unreal: false,
                unlimited: false,
            },
        };
        await saveMembership(membership);
        // Calculate days left
        const now = Date.now();
        const daysLeft = Math.max(0, Math.ceil((response.expiresAt - now) / (24 * 60 * 60 * 1000)));
        return {
            valid: true,
            daysLeft,
            type: response.type,
            features: membership.features,
            message: response.message,
        };
    }
    // Validate existing membership.
    //
    // Apply the same grace fallback used by checkMembershipStatus: if the server
    // rejects the key or is unreachable (e.g. server-side data loss on a phone
    // restart), trust the still-valid, device-bound local membership instead of
    // reporting "0 days" and locking the user out during setup.
    try {
        const validation = await validateMembership({
            key: existing.key,
            deviceId,
        });
        if (validation.valid) {
            return validation;
        }
        return graceFromLocal(existing, deviceId) ?? validation;
    }
    catch {
        const graced = graceFromLocal(existing, deviceId);
        if (graced)
            return graced;
        throw new Error('Membership server unreachable and no valid local membership');
    }
}
/**
 * Check membership status without registration.
 *
 * Grace fallback: if the server rejects the key (e.g. it was wiped on a phone
 * restart) OR the server is unreachable, we trust the local membership.json as
 * long as it is (a) still valid by its own expiry date and (b) bound to THIS
 * device. This prevents a false "membership expired" lockout caused by
 * server-side data loss, without letting genuinely expired keys through or
 * allowing a key file to be copied onto a different machine.
 */
export async function checkMembershipStatus() {
    const membership = await loadMembership();
    if (!membership) {
        return {
            valid: false,
            daysLeft: 0,
            type: 'free',
            features: {
                robloxStudio: false,
                godot: false,
                unity: false,
                unreal: false,
                unlimited: false,
            },
            message: 'No membership found. Run setup to get started.',
        };
    }
    const deviceId = generateDeviceId();
    try {
        const validation = await validateMembership({
            key: membership.key,
            deviceId,
        });
        // Server confirms it — trust the authoritative answer.
        if (validation.valid) {
            return validation;
        }
        // Server rejected. Recover from server-side data loss when it is safe to.
        return graceFromLocal(membership, deviceId) ?? validation;
    }
    catch {
        // Server unreachable — same offline grace, or rethrow so the caller's
        // existing "silently ignore on startup" path keeps the user unblocked.
        const graced = graceFromLocal(membership, deviceId);
        if (graced)
            return graced;
        throw new Error('Membership server unreachable and no valid local membership');
    }
}
/**
 * Decide whether a locally stored membership can be trusted when the server
 * cannot confirm it. Returns a valid status only when the key is still within
 * its own expiry window and belongs to the current device; otherwise null so
 * the caller falls back to the server's verdict.
 */
function graceFromLocal(membership, deviceId) {
    const now = Date.now();
    // Genuinely expired by its own date — no grace.
    if (!Number.isFinite(membership.expiresAt) || membership.expiresAt <= now) {
        return null;
    }
    // Key file copied to a different machine — preserve device binding.
    if (membership.deviceId && membership.deviceId !== deviceId) {
        return null;
    }
    const daysLeft = Math.max(0, Math.ceil((membership.expiresAt - now) / (24 * 60 * 60 * 1000)));
    return {
        valid: true,
        daysLeft,
        type: membership.type,
        features: membership.features,
        message: `Offline/recovery mode — using local membership (${daysLeft} days left).`,
    };
}
/**
 * Get AI rules for current membership
 */
export async function getAIRules(language = 'en', engine = 'roblox') {
    const membership = await loadMembership();
    if (!membership) {
        throw new Error('No membership found');
    }
    const response = await fetchAIRules({
        key: membership.key,
        language,
        engine,
    });
    return response.rules;
}
/**
 * Check if membership needs setup
 */
export async function needsSetup() {
    return !(await hasMembership());
}
/**
 * Detect language from prompt text
 */
export function detectLanguage(text) {
    // Turkish specific characters and common words
    const turkishPatterns = /[ğüşıöçĞÜŞİÖÇ]|bir|ve|için|gibi|olan|bu|şu/i;
    return turkishPatterns.test(text) ? 'tr' : 'en';
}
//# sourceMappingURL=manager.js.map