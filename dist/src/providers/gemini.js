import { GoogleGenAI, } from "@google/genai";
import { kindFromStatus, ProviderError, } from "./base.js";
/**
 * "-latest" takma adı bilinçli tercih: sabit sürümler (ör. gemini-2.5-flash)
 * bir süre sonra yeni API key'lere kapatılıyor ve 404 döndürüyor.
 */
const DEFAULT_MODEL = "gemini-flash-latest";
const DEFAULT_MAX_TOKENS = 4096;
export class GeminiProvider {
    id = "gemini";
    displayName = "Google Gemini";
    defaultModel = DEFAULT_MODEL;
    client;
    constructor(apiKey) {
        if (!apiKey.trim()) {
            throw new ProviderError("gemini", "auth", "API key boş.");
        }
        this.client = new GoogleGenAI({ apiKey });
    }
    async chat(messages, options = {}) {
        const model = options.model ?? DEFAULT_MODEL;
        try {
            const response = await this.client.models.generateContent({
                model,
                contents: toContents(messages),
                config: toConfig(options),
            });
            return {
                text: extractText(response),
                model,
                ...(response.usageMetadata
                    ? {
                        usage: {
                            inputTokens: response.usageMetadata.promptTokenCount ?? 0,
                            outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
                        },
                    }
                    : {}),
                ...(response.candidates?.[0]?.finishReason
                    ? { stopReason: String(response.candidates[0].finishReason) }
                    : {}),
            };
        }
        catch (error) {
            throw toProviderError(error);
        }
    }
    async *chatStream(messages, options = {}) {
        const model = options.model ?? DEFAULT_MODEL;
        try {
            const stream = await this.client.models.generateContentStream({
                model,
                contents: toContents(messages),
                config: toConfig(options),
            });
            let full = "";
            let inputTokens = 0;
            let outputTokens = 0;
            let stopReason;
            for await (const chunk of stream) {
                const text = extractText(chunk);
                if (text) {
                    full += text;
                    yield { type: "text", text };
                }
                if (chunk.usageMetadata) {
                    inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
                    outputTokens =
                        chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
                }
                const finish = chunk.candidates?.[0]?.finishReason;
                if (finish)
                    stopReason = String(finish);
            }
            yield {
                type: "done",
                response: {
                    text: full,
                    model,
                    usage: { inputTokens, outputTokens },
                    ...(stopReason ? { stopReason } : {}),
                },
            };
        }
        catch (error) {
            throw toProviderError(error);
        }
    }
}
/**
 * OnlyCLI mesajlarını Gemini'nin `Content` formatına çevirir.
 * Gemini asistan rolünü "model" olarak adlandırıyor.
 */
function toContents(messages) {
    return messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
    }));
}
/**
 * Yanıttan yalnızca kullanıcıya gösterilecek metni toplar.
 *
 * SDK'nın `response.text` getter'ı, yanıtta metin dışı parça (ör. Gemini 2.5+
 * modellerinin `thoughtSignature` alanı) gördüğünde stderr'e uyarı basıyor.
 * Parçaları kendimiz süzerek hem o uyarıyı hem de düşünce içeriğinin çıktıya
 * karışmasını engelliyoruz.
 */
function extractText(response) {
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts)
        return "";
    let text = "";
    for (const part of parts) {
        // `thought: true` olan parçalar modelin iç muhakemesi; gösterilmemeli.
        if (part.thought === true)
            continue;
        if (typeof part.text === "string")
            text += part.text;
    }
    return text;
}
function toConfig(options) {
    return {
        maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(options.system ? { systemInstruction: options.system } : {}),
        ...(options.temperature !== undefined
            ? { temperature: options.temperature }
            : {}),
        ...(options.signal ? { abortSignal: options.signal } : {}),
    };
}
function toProviderError(error) {
    if (error instanceof ProviderError)
        return error;
    if (error instanceof Error && error.name === "AbortError") {
        return new ProviderError("gemini", "aborted", "İstek iptal edildi.", {
            cause: error,
        });
    }
    // @google/genai HTTP hatalarını ApiError olarak fırlatır; `status` alanı
    // her sürümde tip olarak dışa açılmadığı için savunmalı okuyoruz.
    const status = readStatus(error);
    const raw = readMessage(error) ?? String(error);
    const message = cleanMessage(raw);
    // Bu kontrol status'ten ÖNCE gelmeli: Gemini geçersiz key'e 401 değil 400
    // döndürüyor, dolayısıyla yalnızca status'e bakmak bunu "geçersiz istek"
    // olarak sınıflandırıp kullanıcıya yanlış yol gösteriyor.
    if (/API key not valid|API_KEY_INVALID|API key expired/i.test(raw)) {
        return new ProviderError("gemini", "auth", message, {
            ...(status !== undefined ? { status } : {}),
            cause: error,
        });
    }
    if (status !== undefined) {
        const kind = /quota|billing|exhausted|RESOURCE_EXHAUSTED/i.test(raw)
            ? "quota"
            : kindFromStatus(status);
        return new ProviderError("gemini", kind, message, { status, cause: error });
    }
    if (error instanceof Error &&
        /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(error.message)) {
        return new ProviderError("gemini", "network", error.message, {
            cause: error,
        });
    }
    return new ProviderError("gemini", "unknown", message, { cause: error });
}
/**
 * Gemini hata mesajları içinde kaçış karakterli bir JSON gövdesi taşıyor;
 * ham hali terminalde okunamaz bir blok olarak görünüyor. İçteki asıl
 * `message` alanını çıkarıp yalnızca onu gösteriyoruz.
 */
function cleanMessage(raw) {
    const match = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
    if (match?.[1]) {
        const inner = match[1]
            .replace(/\\n/g, " ")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, "\\")
            .trim();
        // İç içe JSON'da ilk eşleşme yine JSON olabilir; bu durumda bir kez daha dene.
        if (/"message"\s*:/.test(inner))
            return cleanMessage(inner);
        if (inner)
            return inner;
    }
    return raw.replace(/\s+/g, " ").trim();
}
function readStatus(error) {
    if (typeof error !== "object" || error === null)
        return undefined;
    const record = error;
    if (typeof record["status"] === "number")
        return record["status"];
    if (typeof record["code"] === "number")
        return record["code"];
    return undefined;
}
function readMessage(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === "object" && error !== null) {
        const record = error;
        if (typeof record["message"] === "string")
            return record["message"];
    }
    return undefined;
}
//# sourceMappingURL=gemini.js.map