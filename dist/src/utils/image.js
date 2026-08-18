import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
/**
 * Get media type from file extension
 */
function getMediaType(filePath) {
    const ext = filePath.toLowerCase().split(".").pop();
    switch (ext) {
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "gif":
            return "image/gif";
        case "webp":
            return "image/webp";
        default:
            throw new Error(`Unsupported image format: ${ext}`);
    }
}
/**
 * Read image file and convert to base64
 */
export async function readImageFile(filePath) {
    const resolvedPath = resolve(filePath);
    if (!existsSync(resolvedPath)) {
        throw new Error(`Image file not found: ${filePath}`);
    }
    const buffer = await readFile(resolvedPath);
    const base64 = buffer.toString("base64");
    const filename = filePath.split("/").pop() || "image";
    return {
        base64,
        mediaType: getMediaType(filePath),
        filename,
    };
}
/**
 * Extract image from Windows clipboard and save to temp file
 * Works on Windows only
 */
export async function getClipboardImage() {
    try {
        // Check if we're on Windows
        if (process.platform !== "win32") {
            throw new Error("Clipboard image support only works on Windows");
        }
        // Use PowerShell to get image from clipboard
        const tempFile = join(tmpdir(), `clip-${Date.now()}.png`);
        const psCommand = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $img.Save('${tempFile}'); Write-Host 'success' } else { Write-Host 'empty' }`;
        const result = execSync(`powershell -Command "${psCommand}"`, {
            encoding: "utf8",
        }).trim();
        if (result !== "success") {
            return null;
        }
        // Read the temp file
        const imageData = await readImageFile(tempFile);
        // Clean up temp file
        try {
            execSync(`del "${tempFile}"`, { stdio: "ignore" });
        }
        catch {
            // Ignore cleanup errors
        }
        return imageData;
    }
    catch (error) {
        return null;
    }
}
/**
 * Convert image data to provider-specific message content format
 */
export function imageToMessageContent(imageData, provider = "anthropic") {
    switch (provider) {
        case "anthropic":
            // Claude format
            return {
                type: "image",
                source: {
                    type: "base64",
                    media_type: imageData.mediaType,
                    data: imageData.base64,
                },
            };
        case "openai":
            // OpenAI/GPT-4V format
            return {
                type: "image_url",
                image_url: {
                    url: `data:${imageData.mediaType};base64,${imageData.base64}`,
                    detail: "high",
                },
            };
        case "gemini":
            // Google Gemini format
            return {
                type: "image",
                data: {
                    mime_type: imageData.mediaType,
                    data: imageData.base64,
                },
            };
        default:
            return {
                type: "image",
                source: {
                    type: "base64",
                    media_type: imageData.mediaType,
                    data: imageData.base64,
                },
            };
    }
}
/**
 * Check if provider supports vision
 */
export function supportsVision(provider) {
    return ["anthropic", "openai", "gemini"].includes(provider);
}
//# sourceMappingURL=image.js.map