import { z, type ZodType } from "zod";

export type ToolId = string;

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  enum?: string[];
  default?: unknown;
}

export interface ToolDefinition {
  id: ToolId;
  name: string;
  category: "quote" | "knowledge" | "vision" | "analysis" | "dynamic" | "system" | "web" | "pricing";
  description: string;
  parameters: ToolParameter[];
  inputSchema: ZodType;
  requiresConfirmation: boolean;
  mutates: boolean;
  tags: string[];
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  citations?: Array<{ documentId: string; excerpt: string; pageStart?: number; pageEnd?: number; confidence: number }>;
  sideEffects?: string[];
  duration_ms: number;
}

export interface ToolExecutionContext {
  projectId: string;
  revisionId: string;
  quoteId: string;
  userId: string;
  sessionId: string;
  apiBaseUrl: string;
  authToken?: string;
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  definition: ToolDefinition;
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}

// LLM types
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

export interface PrepareStepResult {
  activeTools?: string[];
  toolChoice?: ToolChoice;
  injectMessage?: string;
}

export interface AgentConfig {
  llm: LLMAdapter;
  maxIterations: number;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  abortSignal?: AbortSignal;
  prepareStep?: (step: number, toolCallHistory: { toolId: string; success: boolean }[]) => PrepareStepResult | undefined;
  onToolCall?: (toolCall: { id: string; toolId: string; input: unknown; result: ToolResult }) => void;
  onMessage?: (message: { role: "user" | "assistant"; content: string }) => void;
}

export interface AgentSession {
  id: string;
  projectId: string;
  revisionId: string;
  quoteId: string;
  userId: string;
  messages: ChatMessage[];
  toolCalls: Array<{ id: string; toolId: string; input: unknown; result: ToolResult; timestamp: string }>;
  status: "active" | "waiting_confirmation" | "complete" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface AgentResponse {
  message: string;
  toolCallsExecuted: Array<{ id: string; toolId: string; input: unknown; result: ToolResult }>;
  citations: Array<{ documentId: string; excerpt: string; pageStart?: number; confidence: number }>;
  tokensUsed: { input: number; output: number };
}

export interface DynamicToolConfig {
  id: string;
  toolId: ToolId;
  name: string;
  description: string;
  parameters: ToolParameter[];
  implementation:
    | { type: "calculation"; formula: string }
    | { type: "prompt_template"; prompt: string }
    | { type: "api_call"; url: string; method: string; bodyTemplate: string }
    | { type: "javascript"; code: string };
  createdBy: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
