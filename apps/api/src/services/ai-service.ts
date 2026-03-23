import { createLLMAdapter } from "@bidwright/agent";

export interface AiServiceConfig {
  provider: string;
  apiKey: string;
  model: string;
}

function extractText(response: { content: Array<{ text?: string }> }): string {
  const block = response.content[0];
  return typeof block === "string"
    ? block
    : (block as { text?: string }).text ?? "";
}

function extractJson(text: string): string {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return text.trim();
}

const DEFAULT_PHASES = [
  {
    number: "1",
    name: "Mobilization",
    description: "Site mobilization and setup",
  },
  {
    number: "2",
    name: "Demolition",
    description: "Selective demolition and removal",
  },
  {
    number: "3",
    name: "Rough-In",
    description: "Main installation and rough-in work",
  },
  {
    number: "4",
    name: "Trim & Finish",
    description: "Trim, finish, and accessories",
  },
  {
    number: "5",
    name: "Commissioning",
    description: "Testing, startup, and commissioning",
  },
];

const DEFAULT_EQUIPMENT = [
  {
    name: "Scissor Lift",
    description: "20ft electric scissor lift",
    quantity: 1,
    duration: 30,
    estimatedCost: 2500,
  },
  {
    name: "Forklift",
    description: "5000lb rough terrain forklift",
    quantity: 1,
    duration: 20,
    estimatedCost: 3000,
  },
];

export async function aiRewriteDescription(
  currentDescription: string,
  projectContext: string,
  config?: AiServiceConfig
): Promise<string> {
  if (!config?.apiKey) {
    return `[AI would rewrite this description based on project context]\n\n${currentDescription}`;
  }

  try {
    const adapter = createLLMAdapter({
      provider: config.provider as any,
      apiKey: config.apiKey,
      model: config.model,
    });

    const response = await adapter.chat({
      model: config.model,
      systemPrompt:
        "You are a construction estimating expert. Rewrite the following project description to be professional, clear, and comprehensive for a client-facing quote.",
      messages: [
        {
          role: "user",
          content: `Project context: ${projectContext}\n\nCurrent description:\n${currentDescription}\n\nPlease rewrite this description to be professional and suitable for a client quote.`,
        },
      ],
      maxTokens: 2048,
      temperature: 0.3,
    });

    return extractText(response) || currentDescription;
  } catch {
    return currentDescription;
  }
}

export async function aiRewriteNotes(
  currentNotes: string,
  projectContext: string,
  config?: AiServiceConfig
): Promise<string> {
  if (!config?.apiKey) {
    return `[AI would organize these notes]\n\n${currentNotes}`;
  }

  try {
    const adapter = createLLMAdapter({
      provider: config.provider as any,
      apiKey: config.apiKey,
      model: config.model,
    });

    const response = await adapter.chat({
      model: config.model,
      systemPrompt:
        "You are a construction estimating expert. Organize and improve the following notes for clarity.",
      messages: [
        {
          role: "user",
          content: `Project context: ${projectContext}\n\nCurrent notes:\n${currentNotes}\n\nPlease organize these notes into clear sections.`,
        },
      ],
      maxTokens: 2048,
      temperature: 0.3,
    });

    return extractText(response) || currentNotes;
  } catch {
    return currentNotes;
  }
}

export async function aiSuggestPhases(
  description: string,
  lineItems: unknown[],
  config?: AiServiceConfig
): Promise<Array<{ number: string; name: string; description: string }>> {
  if (!config?.apiKey) {
    return DEFAULT_PHASES;
  }

  try {
    const adapter = createLLMAdapter({
      provider: config.provider as any,
      apiKey: config.apiKey,
      model: config.model,
    });

    const response = await adapter.chat({
      model: config.model,
      systemPrompt:
        "You are a construction project planner. Suggest project phases based on the description and existing line items. Return JSON array.",
      messages: [
        {
          role: "user",
          content: `Project description: ${description}\n\nExisting line items: ${JSON.stringify(lineItems.slice(0, 20))}\n\nSuggest 3-8 construction phases. Return ONLY a JSON array of objects with fields: number (string), name (string), description (string).`,
        },
      ],
      maxTokens: 2048,
      temperature: 0.3,
    });

    const text = extractText(response);
    const json = extractJson(text);
    const parsed = JSON.parse(json);

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_PHASES;
  } catch {
    return DEFAULT_PHASES;
  }
}

export async function aiSuggestEquipment(
  description: string,
  labourItems: unknown[],
  config?: AiServiceConfig
): Promise<
  Array<{
    name: string;
    description: string;
    quantity: number;
    duration: number;
    estimatedCost: number;
  }>
> {
  if (!config?.apiKey) {
    return DEFAULT_EQUIPMENT;
  }

  try {
    const adapter = createLLMAdapter({
      provider: config.provider as any,
      apiKey: config.apiKey,
      model: config.model,
    });

    const response = await adapter.chat({
      model: config.model,
      systemPrompt:
        "You are a construction equipment planner. Suggest equipment based on the project scope and labour items. Return JSON array.",
      messages: [
        {
          role: "user",
          content: `Project description: ${description}\n\nLabour items: ${JSON.stringify(labourItems.slice(0, 20))}\n\nSuggest equipment. Return ONLY a JSON array with fields: name (string), description (string), quantity (number), duration (number, days), estimatedCost (number).`,
        },
      ],
      maxTokens: 2048,
      temperature: 0.3,
    });

    const text = extractText(response);
    const json = extractJson(text);
    const parsed = JSON.parse(json);

    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_EQUIPMENT;
  } catch {
    return DEFAULT_EQUIPMENT;
  }
}
