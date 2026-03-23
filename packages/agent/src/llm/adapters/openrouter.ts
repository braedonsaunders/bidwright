/**
 * @deprecated LLM adapters replaced by CLI-native runtimes.
 * Claude Code / Codex handle LLM calls directly. This file is kept for reference only.
 */
import { OpenAIAdapter } from "./openai.js";
import type { LLMAdapter } from "../types.js";

export class OpenRouterAdapter extends OpenAIAdapter implements LLMAdapter {
  override id = "openrouter";
  override name = "OpenRouter";
  override maxContextTokens = 200000;

  constructor(apiKey: string, defaultModel = "anthropic/claude-sonnet-4-20250514") {
    super(apiKey, defaultModel, "https://openrouter.ai/api/v1");
  }
}
