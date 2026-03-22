import { OpenAIAdapter } from "./openai.js";
import type { LLMAdapter } from "../types.js";

export class LMStudioAdapter extends OpenAIAdapter implements LLMAdapter {
  override id = "lmstudio";
  override name = "LM Studio (Local)";
  override supportsVision = false;
  override maxContextTokens = 32000;

  constructor(defaultModel = "default", baseUrl = "http://localhost:1234/v1") {
    super("lm-studio", defaultModel, baseUrl);
  }
}
