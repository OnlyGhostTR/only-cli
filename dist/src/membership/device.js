/**
 * Device ID generation - machine-based unique identifier
 */
import { createHash } from 'node:crypto';
import { networkInterfaces, hostname, platform, arch } from 'node:os';
/**
 * Generates a unique device ID based on machine characteristics
 * This ID remains consistent across app reinstalls on the same machine
 */
export function generateDeviceId() {
    const interfaces = networkInterfaces();
    // Get MAC addresses from network interfaces
    const macAddresses = [];
    for (const name of Object.keys(interfaces)) {
        const nets = interfaces[name];
        if (nets) {
            for (const net of nets) {
                if (net.mac && net.mac !== '00:00:00:00:00:00') {
                    macAddresses.push(net.mac);
                }
            }
        }
    }
    // Combine multiple machine identifiers
    const identifiers = [
        ...macAddresses,
        hostname(),
        platform(),
        arch(),
    ].join('|');
    // Hash to create a consistent device ID
    return createHash('sha256')
        .update(identifiers)
        .digest('hex')
        .substring(0, 32);
}
/**
 * Get machine info for registration
 */
export function getMachineInfo() {
    return {
        platform: platform(),
        arch: arch(),
        hostname: hostname(),
        nodeVersion: process.version,
    };
}
//# sourceMappingURL=device.js.map