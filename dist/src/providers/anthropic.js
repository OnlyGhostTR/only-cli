import Anthropic from "@anthropic-ai/sdk";
import { kindFromStatus, ProviderError, } from "./base.js";
const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 4096;
export class AnthropicProvider {
    id = "anthropic";
    displayName = "Anthropic Claude";
    defaultModel = DEFAULT_MODEL;
    client;
    constructor(apiKey) {
        if (!apiKey.trim()) {
            throw new ProviderError("anthropic", "auth", "API key boş.");
        }
        this.client = new Anthropic({ apiKey, maxRetries: 2 });
    }
    async chat(messages, options = {}) {
        try {
            const response = await this.client.messages.create({
                model: options.model ?? DEFAULT_MODEL,
                max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
                ...(options.system ? { system: options.system } : {}),
                ...(options.temperature !== undefined
                    ? { temperature: options.temperature }
                    : {}),
            }, options.signal ? { signal: options.signal } : undefined);
            const text = response.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
            return {
                text,
                model: response.model,
                usage: {
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                },
                ...(response.stop_reason ? { stopReason: response.stop_reason } : {}),
            };
        }
        catch (error) {
            throw toProviderError(error);
        }
    }
    async *chatStream(messages, options = {}) {
        try {
            const stream = this.client.messages.stream({
                model: options.model ?? DEFAULT_MODEL,
                max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                messages: messages.map((m) => ({ role: m.role, content: m.content })),
                ...(options.system ? { system: options.system } : {}),
                ...(options.temperature !== undefined
                    ? { temperature: options.temperature }
                    : {}),
            }, options.signal ? { signal: options.signal } : undefined);
            for await (const event of stream) {
                if (event.type === "content_block_delta" &&
                    event.delta.type === "text_delta") {
                    yield { type: "text", text: event.delta.text };
                }
            }
            const final = await stream.finalMessage();
            const text = final.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
            yield {
                type: "done",
                response: {
                    text,
                    model: final.model,
                    usage: {
                        inputTokens: final.usage.input_tokens,
                        outputTokens: final.usage.output_tokens,
                    },
                    ...(final.stop_reason ? { stopReason: final.stop_reason } : {}),
                },
            };
        }
        catch (error) {
            throw toProviderError(error);
        }
    }
}
/** SDK hatalarını ortak `ProviderError` tipine çevirir. */
function toProviderError(error) {
    if (error instanceof ProviderError)
        return error;
    if (error instanceof Anthropic.APIUserAbortError) {
        return new ProviderError("anthropic", "aborted", "İstek iptal edildi.", {
            cause: error,
        });
    }
    if (error instanceof Anthropic.APIConnectionError) {
        return new ProviderError("anthropic", "network", error.message, {
            cause: error,
        });
    }
    if (error instanceof Anthropic.APIError) {
        const message = extractMessage(error) ?? error.message;
        // Anthropic kredi bitiminde 400 + "credit balance" döndürüyor.
        const kind = /credit balance|billing/i.test(message)
            ? "quota"
            : kindFromStatus(error.status);
        return new ProviderError("anthropic", kind, message, {
            ...(error.status !== undefined ? { status: error.status } : {}),
            cause: error,
        });
    }
    if (error instanceof Error && error.name === "AbortError") {
        return new ProviderError("anthropic", "aborted", "İstek iptal edildi.", {
            cause: error,
        });
    }
    return new ProviderError("anthropic", "unknown", error instanceof Error ? error.message : String(error), { cause: error });
}
/** Anthropic hata gövdesindeki asıl mesajı çıkarır (varsa). */
function extractMessage(error) {
    const body = error.error;
    return body?.error?.message;
}
//# sourceMappingURL=anthropic.js.map