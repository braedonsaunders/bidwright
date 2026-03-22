export interface AiServiceConfig {
  provider: string;
  apiKey: string;
  model: string;
}

export async function aiRewriteDescription(
  currentDescription: string,
  _projectContext: string,
  config?: AiServiceConfig
): Promise<string> {
  if (!config?.apiKey) {
    return `[AI would rewrite this description based on project context]\n\n${currentDescription}`;
  }

  // Real implementation would call the LLM adapter:
  // const adapter = createLLMAdapter({ provider: config.provider, apiKey: config.apiKey, model: config.model });
  // const response = await adapter.chat({ ... });
  // return response.content[0].text;

  return currentDescription;
}

export async function aiRewriteNotes(
  currentNotes: string,
  _projectContext: string,
  config?: AiServiceConfig
): Promise<string> {
  if (!config?.apiKey) {
    return `[AI would organize these notes]\n\n${currentNotes}`;
  }
  return currentNotes;
}

export async function aiSuggestPhases(
  _description: string,
  _lineItems: unknown[],
  config?: AiServiceConfig
): Promise<Array<{ number: string; name: string; description: string }>> {
  if (!config?.apiKey) {
    // Return sensible defaults based on common construction phases
    return [
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
  }
  return [];
}

export async function aiSuggestEquipment(
  _description: string,
  _labourItems: unknown[],
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
    return [
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
  }
  return [];
}
