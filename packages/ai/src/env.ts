import { z } from 'zod';

const aiEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_ORG_ID: z.string().optional(),
  OPENAI_PROJECT_ID: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-large'),
});

export type BidwrightAiEnv = z.infer<typeof aiEnvSchema>;

export function loadBidwrightAiEnv(source: NodeJS.ProcessEnv = process.env): BidwrightAiEnv {
  return aiEnvSchema.parse(source);
}
