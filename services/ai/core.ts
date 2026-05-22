
import { GoogleGenAI } from "@google/genai";
import { AIConfig, Provider, CustomEndpoint } from "../../types";
import { stripBase64Prefix } from "../imageUtils";
import { imageStorage } from "../imageStorage";

interface UnifiedClient {
    models: {
        generateContent: (params: { model: string, contents: any[], config?: any }) => Promise<{ text: string, raw: any }>,
        generateContentStream?: (params: { model: string, contents: any[], config?: any }) => Promise<AsyncIterable<{ text?: string }>>
    }
}

// Event Dispatcher Helper - Now Exported
export const dispatchAIStatus = (id: string, color: 'blue' | 'green' | 'yellow' | 'red' | 'gray') => {
    try {
        const event = new CustomEvent('ai_request_update', { 
            detail: { id, color } 
        });
        window.dispatchEvent(event);
    } catch (e) {
        // Ignore errors in non-browser envs
    }
};

// Helper to determine if a provider supports JSON mode enforcement
export const supportsJsonMode = (provider: Provider, customConfig?: CustomEndpoint): boolean => {
    if (provider === Provider.CUSTOM) {
        return customConfig ? customConfig.enableJsonMode : true; // Default to true if not found, but usually controlled
    }
    return [
        Provider.GEMINI, 
        Provider.VOLCANO, 
        Provider.OPENAI, 
        Provider.XAI, 
        Provider.OPENROUTER
    ].includes(provider);
};

// Helper: Pre-process contents to resolve Blob URLs -> Base64
const resolveImagesInContents = async (contents: any[]): Promise<any[]> => {
    const processedContents = await Promise.all(contents.map(async (c) => {
        if (!c.parts) return c;
        
        const newParts = await Promise.all(c.parts.map(async (p: any) => {
            // Check for inlineData
            if (p.inlineData && p.inlineData.data) {
                const rawData = p.inlineData.data;
                // If it looks like a Blob URL or ID (not standard base64)
                if (rawData.startsWith('blob:') || rawData.startsWith('img_')) {
                    const resolvedBase64 = await imageStorage.resolveBase64(rawData);
                    if (resolvedBase64) {
                        return {
                            inlineData: {
                                mimeType: p.inlineData.mimeType,
                                data: stripBase64Prefix(resolvedBase64) // Gemini/Generic handlers usually want raw
                            }
                        };
                    }
                }
            }
            // Also check for image_url type (OpenAI format if manually constructed somewhere)
            if (p.image_url && p.image_url.url) {
                 const url = p.image_url.url;
                 if (url.startsWith('blob:') || url.startsWith('img_')) {
                     const resolvedBase64 = await imageStorage.resolveBase64(url);
                     if (resolvedBase64) {
                         return { ...p, image_url: { ...p.image_url, url: resolvedBase64 } };
                     }
                 }
            }
            return p;
        }));
        
        return { ...c, parts: newParts };
    }));
    return processedContents;
};

// Helper: Filter out images from content parts if Vision is disabled
const filterImagesFromMessages = (messages: any[]): any[] => {
    return messages.map(m => {
        if (Array.isArray(m.content)) {
            const textParts = m.content.filter((p: any) => p.type === 'text');
            // If filtering leaves nothing, use empty string to prevent API errors
            return { ...m, content: textParts.length > 0 ? textParts : "" };
        }
        return m;
    });
};

// Helper: Convert Gemini format messages to OpenAI format
const convertGeminiToOpenAIMessages = (contents: any[]) => {
    return contents.map(c => {
        const role = c.role === 'model' ? 'assistant' : (c.role === 'system' ? 'system' : 'user');
        
        // Convert mixed parts (Text/Image) into OpenAI format
        const contentArray: any[] = [];
        
        c.parts.forEach((p: any) => {
            if (p.text) {
                contentArray.push({ type: "text", text: p.text });
            } else if (p.inlineData) {
                // OpenAI/Volcano expects data URL
                // Ensure base64 is clean (no newlines)
                const rawData = (p.inlineData.data || "").replace(/[\r\n]+/g, '');
                const mimeType = p.inlineData.mimeType || 'image/jpeg';
                
                const dataUrl = rawData.startsWith('data:') 
                    ? rawData 
                    : `data:${mimeType};base64,${rawData}`;
                    
                contentArray.push({ 
                    type: "image_url", 
                    image_url: { 
                        url: dataUrl,
                        detail: "auto" // Explicitly set detail for better compatibility
                    } 
                });
            }
        });

        // Flatten if simple string, otherwise use array.
        // Filter out empty text parts if we have mixed content (e.g. image + empty string)
        let finalContent: any = contentArray;
        
        if (contentArray.length > 1) {
            const filtered = contentArray.filter(item => item.type !== 'text' || (item.text && item.text.trim().length > 0));
            // Only use filtered if we didn't filter everything out
            if (filtered.length > 0) {
                finalContent = filtered;
            }
        }

        // Downgrade to simple string if possible (required for some system prompts)
        if (finalContent.length === 1 && finalContent[0].type === "text") {
            finalContent = finalContent[0].text;
        }

        return {
            role: role,
            content: finalContent
        };
    });
};

export const createClient = (config: AIConfig, apiKeys: Record<string, string>, customEndpoints: CustomEndpoint[] = []): UnifiedClient => {
    const apiKey = config.apiKey || apiKeys[config.provider] || "";
    
    // --- GEMINI HANDLER ---
    if (config.provider === Provider.GEMINI) {
        const ai = new GoogleGenAI({ apiKey });
        return {
            models: {
                generateContent: async (params) => {
                    // Resolve Images (Blob -> Base64)
                    const resolvedContents = await resolveImagesInContents(params.contents);

                    // Pre-process contents to strip base64 headers for Gemini
                    const processedContents = resolvedContents.map(c => ({
                        ...c,
                        parts: c.parts.map((p: any) => {
                            if (p.inlineData && p.inlineData.data) {
                                return {
                                    inlineData: {
                                        mimeType: p.inlineData.mimeType,
                                        data: stripBase64Prefix(p.inlineData.data)
                                    }
                                };
                            }
                            return p;
                        })
                    }));

                    // Inject JSON Priming for Gemini to prevent empty response
                    if (params.config?.responseMimeType === 'application/json') {
                         processedContents.push({
                             role: 'model',
                             parts: [{ text: "好的，我现在开始以JSON输出：" }]
                         });
                    }

                    const res = await ai.models.generateContent({
                        model: params.model,
                        contents: processedContents,
                        config: params.config
                    });
                    // Return both text and raw response object
                    return { text: res.text || "", raw: res };
                },
                generateContentStream: async (params) => {
                    // Resolve Images
                    const resolvedContents = await resolveImagesInContents(params.contents);

                    const processedContents = resolvedContents.map(c => ({
                        ...c,
                        parts: c.parts.map((p: any) => {
                            if (p.inlineData && p.inlineData.data) {
                                return {
                                    inlineData: {
                                        mimeType: p.inlineData.mimeType,
                                        data: stripBase64Prefix(p.inlineData.data)
                                    }
                                };
                            }
                            return p;
                        })
                    }));

                    // Inject JSON Priming for Gemini
                    if (params.config?.responseMimeType === 'application/json') {
                         processedContents.push({
                             role: 'model',
                             parts: [{ text: "好的，我现在开始以JSON输出：" }]
                         });
                    }

                    const res = await ai.models.generateContentStream({
                        model: params.model,
                        contents: processedContents,
                        config: params.config
                    });
                    
                    // Convert to async iterable that yields { text }
                    return (async function* () {
                         for await (const chunk of res) {
                             yield { text: chunk.text };
                         }
                    })();
                }
            }
        }
    }
    
    // --- OPENAI COMPATIBLE HANDLER (STANDARD & CUSTOM) ---
    return {
        models: {
            generateContent: async (params) => {
                let baseURL = "https://api.openai.com/v1";
                let effectiveApiKey = apiKey;
                let enableVision = true;
                let enableJsonMode = true;
                let extraBody: any = {};
                let extraHeaders: any = {};

                // Handle Custom Provider
                if (config.provider === Provider.CUSTOM) {
                    const endpoint = customEndpoints.find(e => e.id === config.customEndpointId);
                    if (endpoint) {
                        baseURL = endpoint.baseUrl.replace(/\/$/, ""); // Strip trailing slash
                        if (endpoint.apiKey) effectiveApiKey = endpoint.apiKey;
                        enableVision = endpoint.enableVision;
                        enableJsonMode = endpoint.enableJsonMode;
                        
                        try {
                            if (endpoint.extraBody) Object.assign(extraBody, JSON.parse(endpoint.extraBody));
                            if (endpoint.headers) Object.assign(extraHeaders, JSON.parse(endpoint.headers));
                        } catch (e) {
                            console.warn("Failed to parse custom JSON params", e);
                        }
                    } else {
                        // Fallback if endpoint deleted
                        console.warn("Selected custom endpoint not found, using OpenAI default.");
                    }
                } else {
                    // Standard Providers
                    const baseURLs: Record<string, string> = {
                        [Provider.XAI]: "https://api.x.ai/v1",
                        [Provider.OPENAI]: "https://api.openai.com/v1",
                        [Provider.OPENROUTER]: "https://openrouter.ai/api/v1",
                        [Provider.VOLCANO]: "https://ark.cn-beijing.volces.com/api/v3",
                        [Provider.CLAUDE]: "https://api.anthropic.com/v1"
                    };
                    baseURL = baseURLs[config.provider] || baseURL;
                }

                // Resolve Images
                const resolvedContents = await resolveImagesInContents(params.contents);
                let messages = convertGeminiToOpenAIMessages(resolvedContents);

                // Vision Capability Check
                if (!enableVision) {
                    messages = filterImagesFromMessages(messages);
                }

                const bodyPayload: any = {
                    model: params.model,
                    messages: messages,
                    temperature: config.temperature,
                    ...extraBody // Merge extra params
                };

                // Add Reasoning Effort only if explicitly set and NOT 'none' (mostly for standard O1/O3)
                if (config.reasoningEffort && config.reasoningEffort !== 'none') {
                     bodyPayload.reasoning_effort = config.reasoningEffort;
                }

                // JSON Mode Logic
                if (params.config?.responseMimeType === 'application/json') {
                    if (enableJsonMode) {
                        bodyPayload.response_format = { type: "json_object" };
                    }
                    // Even if json mode is disabled, we rely on prompt engineering (handled in feature prompts)
                }

                const response = await fetch(`${baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${effectiveApiKey}`,
                        ...extraHeaders
                    },
                    body: JSON.stringify(bodyPayload)
                });
                
                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`API Error: ${response.status} ${response.statusText} - ${errText}`);
                }

                const data = await response.json();
                // Return text and the full raw data JSON
                return { text: data.choices?.[0]?.message?.content || "", raw: data };
            },
            
            generateContentStream: async (params) => {
                let baseURL = "https://api.openai.com/v1";
                let effectiveApiKey = apiKey;
                let enableVision = true;
                let enableJsonMode = true;
                let extraBody: any = {};
                let extraHeaders: any = {};

                // Handle Custom Provider (Stream)
                if (config.provider === Provider.CUSTOM) {
                    const endpoint = customEndpoints.find(e => e.id === config.customEndpointId);
                    if (endpoint) {
                        baseURL = endpoint.baseUrl.replace(/\/$/, "");
                        if (endpoint.apiKey) effectiveApiKey = endpoint.apiKey;
                        enableVision = endpoint.enableVision;
                        enableJsonMode = endpoint.enableJsonMode;
                        try {
                            if (endpoint.extraBody) Object.assign(extraBody, JSON.parse(endpoint.extraBody));
                            if (endpoint.headers) Object.assign(extraHeaders, JSON.parse(endpoint.headers));
                        } catch (e) {}
                    }
                } else {
                    const baseURLs: Record<string, string> = {
                        [Provider.XAI]: "https://api.x.ai/v1",
                        [Provider.OPENAI]: "https://api.openai.com/v1",
                        [Provider.OPENROUTER]: "https://openrouter.ai/api/v1",
                        [Provider.VOLCANO]: "https://ark.cn-beijing.volces.com/api/v3",
                        [Provider.CLAUDE]: "https://api.anthropic.com/v1"
                    };
                    baseURL = baseURLs[config.provider] || baseURL;
                }
                
                // Resolve Images
                const resolvedContents = await resolveImagesInContents(params.contents);
                let messages = convertGeminiToOpenAIMessages(resolvedContents);

                if (!enableVision) {
                    messages = filterImagesFromMessages(messages);
                }

                const bodyPayload: any = {
                    model: params.model,
                    messages: messages,
                    temperature: config.temperature,
                    stream: true, // Enable Streaming
                    ...extraBody
                };

                if (config.reasoningEffort && config.reasoningEffort !== 'none') {
                     bodyPayload.reasoning_effort = config.reasoningEffort;
                }

                if (params.config?.responseMimeType === 'application/json' && enableJsonMode) {
                    bodyPayload.response_format = { type: "json_object" };
                }

                const response = await fetch(`${baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${effectiveApiKey}`,
                        ...extraHeaders
                    },
                    body: JSON.stringify(bodyPayload)
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`API Error: ${response.status} - ${errText}`);
                }

                if (!response.body) throw new Error("No response body for stream.");

                const reader = response.body.getReader();
                const decoder = new TextDecoder();

                return (async function* () {
                    let buffer = "";
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            const chunk = decoder.decode(value, { stream: true });
                            buffer += chunk;
                            
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || ""; // Keep incomplete line
                            
                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed || trimmed === 'data: [DONE]') continue;
                                if (trimmed.startsWith('data: ')) {
                                    try {
                                        const json = JSON.parse(trimmed.slice(6));
                                        const delta = json.choices?.[0]?.delta?.content;
                                        if (delta) {
                                            yield { text: delta };
                                        }
                                    } catch (e) {
                                        // Ignore parsing errors for partial chunks
                                    }
                                }
                            }
                        }
                    } finally {
                        reader.releaseLock();
                    }
                })();
            }
        }
    }
}

// ... existing connection test utility ...
export const testModelConnection = async (
    config: AIConfig,
    apiKey: string,
    customEndpoints: CustomEndpoint[] = []
): Promise<{ success: boolean; response: string; requestDetails: any; latency: number }> => {
    const start = Date.now();
    // Create a temporary client with the specific key
    const client = createClient(config, { [config.provider]: apiKey }, customEndpoints);
    
    const testMessage = "Hello! Please reply with 'Connection Successful' if you receive this.";
    const contents = [{ role: 'user', parts: [{ text: testMessage }] }];

    try {
        const result = await client.models.generateContent({
            model: config.model || "",
            contents: contents
        });
        
        const end = Date.now();
        return {
            success: true,
            response: result.text,
            latency: end - start,
            requestDetails: {
                provider: config.provider,
                model: config.model,
                endpoint: config.provider === 'gemini' ? 'GoogleGenAI SDK' : 'REST /chat/completions',
                messages: contents,
                reasoningEffort: config.reasoningEffort,
                fullResponse: result.raw // Capture full response for debug
            }
        };
    } catch (e: any) {
        const end = Date.now();
        return {
            success: false,
            response: `Error: ${e.message}`,
            latency: end - start,
            requestDetails: {
                provider: config.provider,
                model: config.model,
                messages: contents,
                error: e.toString()
            }
        };
    }
};

export const robustGenerate = async <T>(
    callApi: () => Promise<{ text: string, raw: any }>,
    validator: (json: any) => any,
    maxRetries: number = 3,
    onFailure?: (error: any, rawResponse?: string) => void,
    onSuccess?: (raw: any) => void
): Promise<T | null> => {
    let attempts = 0;
    // Generate a unique ID for this specific request sequence
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    let lastRawText = "";

    while (attempts < maxRetries) {
        try {
            // Dispatch color based on attempt number (0=Blue/Processing, 1=Yellow, 2=Red)
            const color = attempts === 0 ? 'blue' : (attempts === 1 ? 'yellow' : 'red');
            dispatchAIStatus(requestId, color);

            const result = await callApi();
            lastRawText = result.text;
            let text = result.text;
            // Clean markdown code blocks if present
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const json = JSON.parse(text);
            const validated = validator(json);
            if (validated) {
                dispatchAIStatus(requestId, 'green'); // Success
                
                // Invoke Success Callback with RAW data
                if (onSuccess) {
                    onSuccess(result.raw);
                }
                
                return json as T;
            } else {
                throw new Error("Validation Failed");
            }
        } catch (e) {
            console.warn(`Generate attempt ${attempts + 1} failed:`, e);
            if (attempts === maxRetries - 1 && onFailure) {
                onFailure(e, lastRawText);
            }
        }
        attempts++;
    }

    // Final failure
    dispatchAIStatus(requestId, 'gray');
    return null;
};
