/**
 * Membership API client - communicates with OnlyCLI backend via tunnel
 */
import { USER_AGENT } from '../version.js';
const TUNNEL_URL_API = 'https://onlycli.vercel.app/api/tunnel';
// Cache tunnel URL for 5 minutes
let cachedTunnelUrl = null;
let cacheExpiry = 0;
/**
 * Get tunnel URL from Vercel (cached)
 */
async function getTunnelUrlCached() {
    const now = Date.now();
    // Return cached if still valid
    if (cachedTunnelUrl && cacheExpiry > now) {
        return cachedTunnelUrl;
    }
    // Fetch fresh tunnel URL
    const response = await fetch(TUNNEL_URL_API);
    if (!response.ok) {
        throw new Error('Failed to fetch tunnel URL from Vercel');
    }
    const data = await response.json();
    if (!data.url) {
        throw new Error('No tunnel URL available. Server may be offline.');
    }
    // Cache for 5 minutes
    cachedTunnelUrl = data.url;
    cacheExpiry = now + (5 * 60 * 1000);
    return cachedTunnelUrl;
}
/**
 * Register a new free membership (15 days)
 */
export async function registerMembership(request) {
    const tunnelUrl = await getTunnelUrlCached();
    const response = await fetch(`${tunnelUrl}/api/membership/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(request),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(error.message || 'Failed to register membership');
    }
    return response.json();
}
/**
 * Validate existing membership key
 */
export async function validateMembership(request) {
    const tunnelUrl = await getTunnelUrlCached();
    const response = await fetch(`${tunnelUrl}/api/membership/validate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(request),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(error.message || 'Failed to validate membership');
    }
    return response.json();
}
/**
 * Fetch AI rules for specific engine and language
 */
export async function fetchAIRules(request) {
    const tunnelUrl = await getTunnelUrlCached();
    const params = new URLSearchParams({
        key: request.key,
        language: request.language,
        ...(request.engine ? { engine: request.engine } : {}),
    });
    const response = await fetch(`${tunnelUrl}/api/membership/rules?${params}`, {
        headers: {
            'User-Agent': USER_AGENT,
        },
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(error.message || 'Failed to fetch AI rules');
    }
    return response.json();
}
/**
 * Get tunnel URL directly (for debugging)
 */
export async function getTunnelUrl() {
    return getTunnelUrlCached();
}
//# sourceMappingURL=api.js.map