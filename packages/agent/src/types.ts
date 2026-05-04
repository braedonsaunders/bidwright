export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatContentBlock[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ChatContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  toolUseId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: string;
  imageData?: string;
  imageMimeType?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolChoice = "auto" | "required" | "none" | { type: "function"; name: string };

export interface ChatRequest {
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  toolChoice?: ToolChoice;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResponse {
  content: ChatContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  usage: { inputTokens: number; outputTokens: number };
}

export interface StreamChunk {
  type: "text_delta" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "tool_result" | "confirmation_needed" | "plan_update" | "error" | "done";
  data: unknown;
  timestamp: string;
}

export interface LLMAdapter {
  id: string;
  name: string;
  supportsTools: boolean;
  supportsVision: boolean;
  maxContextTokens: number;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream?(request: ChatRequest): AsyncIterable<StreamChunk>;
}

export interface ProviderConfig {
  provider: "anthropic" | "openai" | "openrouter" | "gemini" | "lmstudio" | "codex";
  apiKey?: string;
  baseUrl?: string;
  model: string;
  organizationId?: string;
}
