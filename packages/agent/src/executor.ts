import type { Tool, ToolExecutionContext, ToolResult } from "./types.js";

export interface ExecutorOptions {
  timeoutMs?: number;
  retries?: number;
  onBeforeExecute?: (toolId: string, input: unknown) => Promise<void>;
  onAfterExecute?: (toolId: string, input: unknown, result: ToolResult) => Promise<void>;
}

export class ToolExecutor {
  constructor(private options: ExecutorOptions = {}) {}

  async execute<TInput, TOutput>(
    tool: Tool<TInput, TOutput>,
    input: TInput,
    context: ToolExecutionContext
  ): Promise<ToolResult<TOutput>> {
    const timeoutMs = this.options.timeoutMs ?? 30000;
    const retries = this.options.retries ?? 0;

    // Validate input
    const parseResult = tool.definition.inputSchema.safeParse(input);
    if (!parseResult.success) {
      return {
        success: false,
        error: `Input validation failed: ${parseResult.error.message}`,
        duration_ms: 0,
      };
    }

    if (this.options.onBeforeExecute) {
      await this.options.onBeforeExecute(tool.definition.id, input);
    }

    let lastError: string | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await Promise.race([
          tool.execute(parseResult.data as TInput, context),
          new Promise<ToolResult<TOutput>>((_, reject) =>
            setTimeout(() => reject(new Error(`Tool ${tool.definition.id} timed out after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);

        if (this.options.onAfterExecute) {
          await this.options.onAfterExecute(tool.definition.id, input, result as ToolResult);
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < retries) continue;
      }
    }

    return {
      success: false,
      error: lastError ?? "Unknown error",
      duration_ms: 0,
    };
  }
}
