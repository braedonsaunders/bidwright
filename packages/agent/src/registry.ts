import type { Tool, ToolDefinition, ToolId, ToolSpec } from "./types.js";

export class ToolRegistry {
  private tools = new Map<ToolId, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.definition.id, tool);
  }

  registerMany(tools: Tool[]): void {
    for (const tool of tools) this.register(tool);
  }

  get(id: ToolId): Tool | undefined {
    return this.tools.get(id);
  }

  has(id: ToolId): boolean {
    return this.tools.has(id);
  }

  list(filter?: { category?: string; tags?: string[]; search?: string }): ToolDefinition[] {
    let defs = Array.from(this.tools.values()).map(t => t.definition);
    if (filter?.category) defs = defs.filter(d => d.category === filter.category);
    if (filter?.tags?.length) defs = defs.filter(d => filter.tags!.some(tag => d.tags.includes(tag)));
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      defs = defs.filter(d => d.name.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || d.tags.some(t => t.includes(q)));
    }
    return defs;
  }

  remove(id: ToolId): boolean {
    return this.tools.delete(id);
  }

  count(): number {
    return this.tools.size;
  }

  categories(): string[] {
    return [...new Set(Array.from(this.tools.values()).map(t => t.definition.category))];
  }

  /** Convert all (or filtered) tools to the normalized ToolSpec format for LLM consumption */
  toToolSpecs(filter?: { category?: string; ids?: ToolId[] }): ToolSpec[] {
    let tools = Array.from(this.tools.values());
    if (filter?.category) tools = tools.filter(t => t.definition.category === filter.category);
    if (filter?.ids) tools = tools.filter(t => filter.ids!.includes(t.definition.id));
    return tools.map(t => ({
      name: t.definition.id,
      description: t.definition.description,
      inputSchema: zodToJsonSchema(t.definition.inputSchema),
    }));
  }
}

/** Convert a Zod schema to JSON Schema (simplified) */
function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  // Use zod-to-json-schema if available, otherwise basic conversion
  try {
    const zodSchema = schema as any;
    if (zodSchema?._def?.typeName === "ZodObject") {
      const shape = zodSchema.shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const fieldDef = value as any;
        properties[key] = zodFieldToJsonSchema(fieldDef);
        if (!fieldDef.isOptional?.()) required.push(key);
      }
      return { type: "object", properties, required };
    }
  } catch { /* fallback */ }
  return { type: "object", properties: {} };
}

function zodFieldToJsonSchema(field: any): Record<string, unknown> {
  const typeName = field?._def?.typeName;
  switch (typeName) {
    case "ZodString": return { type: "string", description: field._def.description ?? "" };
    case "ZodNumber": return { type: "number", description: field._def.description ?? "" };
    case "ZodBoolean": return { type: "boolean" };
    case "ZodEnum": return { type: "string", enum: field._def.values };
    case "ZodNullable": return { ...zodFieldToJsonSchema(field._def.innerType), nullable: true };
    case "ZodOptional": return zodFieldToJsonSchema(field._def.innerType);
    case "ZodArray": return { type: "array", items: zodFieldToJsonSchema(field._def.type) };
    default: return { type: "string" };
  }
}
