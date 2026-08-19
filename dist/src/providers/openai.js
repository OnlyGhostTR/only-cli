/**
 * OpenAI ve OpenAI uyumlu uç noktalar.
 *
 * Tek bir sağlayıcı iki işi görüyor: `baseUrl` verilmezse resmi OpenAI API'si,
 * verilirse aynı şemayı konuşan herhangi bir servis (OpenRouter, Groq,
 * Together, DeepSeek, yerel Ollama/llama.cpp, kendi proxy'niz). Ayrı bir
 * "openai-compatible" sağlayıcısı açmak yerine bunu birleştirmek, arayüzün
 * gerçekten aynı olması nedeniyle daha az kod ve daha az sapma demek.
 */
import OpenAI from "openai";
import { kindFromStatus, normalizeBaseUrl, ProviderError, } from "./base.js";
const DEFAULT_MODEL = "gpt-5";
const DEFAULT_MAX_TOKENS = 4096;
/**
 * Native tool çağrısını turn.ts'in beklediği `TOOL_CALL:` metnine çevirir.
 *
 * Akış modunda tool çağrıları içerik yerine delta olarak geliyor; metin boş
 * kaldığı için üst katman çağrıyı göremiyordu. `chat()` ile aynı sözleşmeyi
 * kullanıyoruz. Tek çağrı taşınır: turn.ts turda tek MCP isteği işliyor.
 * Test edilebilmesi için dışa açık.
 */
export function encodeToolCall(toolCalls) {
    const call = toolCalls.find((entry) => entry?.function.name);
    if (!call)
        return null;
    return `TOOL_CALL:${call.function.name}:${call.function.arguments || "{}"}`;
}
export class OpenAIProvider {
    id = "openai";
    displayName;
    defaultModel;
    /** Fiilen kullanılan uç nokta; UI'da gösterilir ki kullanıcı nereye gittiğini bilsin. */
    baseUrl;
    client;
    constructor(init) {
        if (!init.apiKey.trim()) {
            throw new ProviderError("openai", "auth", "API key boş.");
        }
        // normalizeBaseUrl geçersiz değerde fırlatır; buraya gelen değer güvenli.
        this.baseUrl = init.baseUrl ? normalizeBaseUrl(init.baseUrl) : undefined;
        this.defaultModel = init.model?.trim() || DEFAULT_MODEL;
        this.displayName = this.baseUrl
            ? `OpenAI uyumlu (${hostOf(this.baseUrl)})`
            : "OpenAI";
        this.client = new OpenAI({
            apiKey: init.apiKey,
            maxRetries: 2,
            ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
        });
    }
    async chat(messages, options = {}) {
        try {
            const params = {
                model: options.model ?? this.defaultModel,
                max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                messages: toOpenAIMessages(messages, options.system),
                ...(options.temperature !== undefined
                    ? { temperature: options.temperature }
                    : {}),
            };
            // Add MCP tools if available
            if (options.mcpTools && options.mcpTools.length > 0) {
                params.tools = options.mcpTools.map(tool => ({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description || '',
                        parameters: tool.inputSchema || { type: 'object', properties: {} },
                    },
                }));
                params.tool_choice = 'auto';
            }
            const response = await this.client.chat.completions.create(params, options.signal ? { signal: options.signal } : undefined);
            const choice = response.choices[0];
            // Handle tool calls
            if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
                const toolCall = choice.message.tool_calls[0];
                if (toolCall && 'function' in toolCall && toolCall.function) {
                    const toolResult = {
                        text: `TOOL_CALL:${toolCall.function.name}:${toolCall.function.arguments}`,
                        model: response.model,
                        ...(response.usage
                            ? {
                                usage: {
                                    inputTokens: response.usage.prompt_tokens,
                                    outputTokens: response.usage.completion_tokens,
                                },
                            }
                            : {}),
                    };
                    return toolResult;
                }
            }
            return {
                text: choice?.message?.content ?? "",
                model: response.model,
                ...(response.usage
                    ? {
                        usage: {
                            inputTokens: response.usage.prompt_tokens,
                            outputTokens: response.usage.completion_tokens,
                        },
                    }
                    : {}),
                ...(choice?.finish_reason ? { stopReason: choice.finish_reason } : {}),
            };
        }
        catch (error) {
            throw this.toProviderError(error);
        }
    }
    async *chatStream(messages, options = {}) {
        try {
            const params = {
                model: options.model ?? this.defaultModel,
                max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                messages: toOpenAIMessages(messages, options.system),
                stream: true,
                // Uyumlu uç noktaların bir kısmı kullanım bilgisini yalnızca
                // istendiğinde döndürüyor; desteklemeyenler bu alanı yok sayıyor.
                stream_options: { include_usage: true },
                ...(options.temperature !== undefined
                    ? { temperature: options.temperature }
                    : {}),
            };
            // Add MCP tools if available
            if (options.mcpTools && options.mcpTools.length > 0) {
                params.tools = options.mcpTools.map(tool => ({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description || '',
                        parameters: tool.inputSchema || { type: 'object', properties: {} },
                    },
                }));
                params.tool_choice = 'auto';
            }
            const stream = await this.client.chat.completions.create(params, options.signal ? { signal: options.signal } : undefined);
            let text = "";
            let model = options.model ?? this.defaultModel;
            let stopReason;
            let usage;
            let toolCalls = [];
            for await (const chunk of stream) {
                if (chunk.model)
                    model = chunk.model;
                const choice = chunk.choices[0];
                // Handle tool calls in streaming
                if (choice?.delta?.tool_calls) {
                    for (const toolCall of choice.delta.tool_calls) {
                        if (toolCall.index === undefined)
                            continue;
                        // `noUncheckedIndexedAccess` açık: dizi erişimini tek bir yerel
                        // değişkende topluyoruz, böylece her kullanımda undefined kontrolü
                        // tekrarlanmıyor.
                        let entry = toolCalls[toolCall.index];
                        if (!entry) {
                            entry = {
                                id: toolCall.id || '',
                                function: { name: toolCall.function?.name || '', arguments: '' },
                            };
                            toolCalls[toolCall.index] = entry;
                        }
                        if (toolCall.id)
                            entry.id = toolCall.id;
                        if (toolCall.function?.name) {
                            entry.function.name = toolCall.function.name;
                        }
                        if (toolCall.function?.arguments) {
                            entry.function.arguments += toolCall.function.arguments;
                        }
                    }
                }
                const delta = choice?.delta?.content;
                if (delta) {
                    text += delta;
                    yield { type: "text", text: delta };
                }
                if (choice?.finish_reason)
                    stopReason = choice.finish_reason;
                if (chunk.usage) {
                    usage = {
                        inputTokens: chunk.usage.prompt_tokens,
                        outputTokens: chunk.usage.completion_tokens,
                    };
                }
            }
            // Native tool çağrısı geldiyse metin yerine onu döndürüyoruz: turn.ts
            // `TOOL_CALL:` önekini görüp MCP isteğini çalıştırıyor.
            const encodedCall = encodeToolCall(toolCalls);
            yield {
                type: "done",
                response: {
                    text: encodedCall ?? text,
                    model,
                    ...(usage ? { usage } : {}),
                    ...(stopReason ? { stopReason } : {}),
                },
            };
        }
        catch (error) {
            throw this.toProviderError(error);
        }
    }
    /**
     * SDK hatalarını ortak tipe çevirir.
     *
     * Uyumlu uç noktalar hata gövdesini OpenAI kadar tutarlı döndürmüyor; bu
     * yüzden mesaj çıkarımı savunmacı ve hata metnine base URL ekleniyor —
     * yanlış yapılandırılmış bir proxy'yi teşhis etmenin en hızlı yolu bu.
     */
    toProviderError(error) {
        if (error instanceof ProviderError)
            return error;
        if (error instanceof OpenAI.APIUserAbortError) {
            return new ProviderError("openai", "aborted", "İstek iptal edildi.", {
                cause: error,
            });
        }
        if (error instanceof OpenAI.APIConnectionError) {
            const where = this.baseUrl ? ` (${this.baseUrl})` : "";
            return new ProviderError("openai", "network", `${error.message}${where}`, { cause: error });
        }
        if (error instanceof OpenAI.APIError) {
            const message = extractMessage(error) ?? error.message;
            const kind = /quota|insufficient_quota|billing|credit/i.test(message)
                ? "quota"
                : kindFromStatus(error.status);
            return new ProviderError("openai", kind, this.annotate(message, kind), {
                ...(error.status !== undefined ? { status: error.status } : {}),
                cause: error,
            });
        }
        if (error instanceof Error && error.name === "AbortError") {
            return new ProviderError("openai", "aborted", "İstek iptal edildi.", {
                cause: error,
            });
        }
        return new ProviderError("openai", "unknown", error instanceof Error ? error.message : String(error), { cause: error });
    }
    /** Özel uç noktada 404/401 aldığında sorunun nerede olduğunu söyler. */
    annotate(message, kind) {
        if (!this.baseUrl)
            return message;
        if (kind === "not_found") {
            return `${message} — ${this.baseUrl} bu modeli tanımıyor olabilir; "/model <ad>" ile değiştirin veya base URL'i kontrol edin.`;
        }
        if (kind === "auth") {
            return `${message} — key ${this.baseUrl} tarafından reddedildi.`;
        }
        return message;
    }
}
/**
 * Ortak mesaj listesini OpenAI biçimine çevirir. Sistem talimatı ayrı alan
 * olarak taşınmadığı için ilk mesaj olarak başa ekleniyor.
 */
function toOpenAIMessages(messages, system) {
    const result = [];
    if (system)
        result.push({ role: "system", content: system });
    for (const message of messages) {
        result.push({ role: message.role, content: message.content });
    }
    return result;
}
function extractMessage(error) {
    const body = error.error;
    return body?.error?.message ?? body?.message;
}
function hostOf(baseUrl) {
    try {
        return new URL(baseUrl).host;
    }
    catch {
        return baseUrl;
    }
}
//# sourceMappingURL=openai.js.map