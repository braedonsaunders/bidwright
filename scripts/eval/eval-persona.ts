type PersonaChoice = { id: string; enabled: boolean; isDefault: boolean };

export function selectEvalPersona<T extends PersonaChoice>(personas: T[], choice?: string): T | null {
  if (choice === "none") return null;
  if (!choice) return personas.find((persona) => persona.enabled && persona.isDefault) ?? null;
  const selected = personas.find((persona) => persona.id === choice);
  if (!selected?.enabled) throw new Error(`Persona is missing or disabled: ${choice}`);
  return selected;
}
