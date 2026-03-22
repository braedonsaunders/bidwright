import OpenAI from 'openai';

import { loadBidwrightAiEnv, type BidwrightAiEnv } from './env.js';

export interface BidwrightOpenAIClientOptions extends Partial<BidwrightAiEnv> {
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}

export function createOpenAIClient(options: BidwrightOpenAIClientOptions = {}): OpenAI {
  const env = loadBidwrightAiEnv();

  return new OpenAI({
    apiKey: options.OPENAI_API_KEY ?? env.OPENAI_API_KEY,
    organization: options.OPENAI_ORG_ID ?? env.OPENAI_ORG_ID,
    project: options.OPENAI_PROJECT_ID ?? env.OPENAI_PROJECT_ID,
    baseURL: options.baseURL,
    timeout: options.timeout,
    maxRetries: options.maxRetries,
  });
}
