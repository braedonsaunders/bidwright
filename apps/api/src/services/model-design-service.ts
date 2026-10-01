import type { ChatMessage, TenantAiConfig } from "@bidwright/agent";
import { MODEL_DESIGN_INSTRUCTIONS, validateModelDesign, type ModelDesign } from "@bidwright/domain";

export function parseModelDesignResponse(text: string): { message: string; recipe: ModelDesign | null } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  const data = JSON.parse(cleaned);
  if (typeof data.message !== "string" || !data.message.trim() || data.message.length > 4000) throw new Error("The model returned an invalid explanation");
  if (data.recipe !== null) validateModelDesign(data.recipe);
  return { message: data.message, recipe: data.recipe };
}

export async function generateModelDesign(config: TenantAiConfig, input: {
  prompt: string;
  recipe?: ModelDesign | null;
  context?: unknown;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  feedback?: string;
}) {
  const { createLLMAdapter } = await import("@bidwright/agent");
  const adapter = createLLMAdapter(config);
  const messages: ChatMessage[] = [
    ...(input.history ?? []).slice(-16),
    { role: "user", content: JSON.stringify({ request: input.prompt, currentRecipe: input.recipe ?? null, liveModel: input.context ?? null, executionFeedback: input.feedback ?? null }) },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await adapter.chat({ model: config.model, systemPrompt: MODEL_DESIGN_INSTRUCTIONS, messages, maxTokens: 16000, temperature: 0.2 });
    const text = response.content.filter(b => b.type === "text").map(b => b.text ?? "").join("\n");
    try {
      return parseModelDesignResponse(text);
    } catch (error) {
      if (attempt === 1) throw new Error(`The AI could not produce a valid design: ${error instanceof Error ? error.message : String(error)}`);
      messages.push({ role: "assistant", content: text }, { role: "user", content: `Repair the JSON design. Validation error: ${error instanceof Error ? error.message : String(error)}. Return the complete JSON response.` });
    }
  }
  throw new Error("Design generation failed");
}
