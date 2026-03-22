export type { LLMAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./types.js";
export { AnthropicAdapter } from "./adapters/anthropic.js";
export { OpenAIAdapter } from "./adapters/openai.js";
export { OpenRouterAdapter } from "./adapters/openrouter.js";
export { GeminiAdapter } from "./adapters/gemini.js";
export { LMStudioAdapter } from "./adapters/lmstudio.js";

import type { LLMAdapter, ProviderConfig } from "./types.js";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { LMStudioAdapter } from "./adapters/lmstudio.js";

export function createLLMAdapter(config: ProviderConfig): LLMAdapter {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicAdapter(config.apiKey ?? "", config.model);
    case "openai":
      return new OpenAIAdapter(config.apiKey ?? "", config.model, config.baseUrl);
    case "openrouter":
      return new OpenRouterAdapter(config.apiKey ?? "", config.model);
    case "gemini":
      return new GeminiAdapter(config.apiKey ?? "", config.model);
    case "lmstudio":
      return new LMStudioAdapter(config.model, config.baseUrl ?? "http://localhost:1234/v1");
    default:
      throw new Error(`Unknown LLM provider: ${(config as ProviderConfig).provider}`);
  }
}
