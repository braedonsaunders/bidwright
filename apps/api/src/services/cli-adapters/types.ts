/**
 * Adapter types — every supported CLI runtime implements `CliAdapter`.
 *
 * The runtime orchestrator (cli-runtime.ts) handles per-project workspace
 * scaffolding, session lifecycle, the watchdog, Windows .bat shim, and SSE
 * event bus. Adapters supply the CLI-specific pieces:
 *
 *   1. detection + auth
 *   2. native config files (.claude/settings.json, .codex/config.toml, ...)
 *   3. spawn args (initial + resume)
 *   4. stdout JSONL → SSEEventData translation
 *   5. session-id extraction (for --resume)
 *   6. model listing + reasoning-effort mapping
 */

export type AgentReasoningEffort =
  | "auto"
  | "low"
  | "medium"
  | "high"
  | "extra_high"
  | "max";

export interface CliModelOption {
  id: string;
  name: string;
  description: string;
  defaultReasoningEffort?: string | null;
  hidden?: boolean;
  isDefault?: boolean;
  supportedReasoningEfforts?: string[];
}

export interface SSEEventData {
  type:
    | "thinking"
    | "tool_call"
    | "tool_result"
    | "message"
    | "progress"
    | "error"
    | "status"
    | "file_read";
  data: unknown;
}

export interface CliDetectResult {
  available: boolean;
  path: string;
  version?: string;
}

export interface CliAuthStatus {
  authenticated: boolean;
  method: string;
}

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  openrouter?: string;
}

export interface McpEnv {
  BIDWRIGHT_API_URL: string;
  BIDWRIGHT_AUTH_TOKEN: string;
  BIDWRIGHT_PROJECT_ID: string;
  BIDWRIGHT_REVISION_ID: string;
  BIDWRIGHT_QUOTE_ID: string;
}

export interface PrepareWorkspaceCtx {
  projectDir: string;
  mcpRunner: string;
  mcpArgs: string[];
  mcpEnv: McpEnv;
  permissions: string[];
  isWin: boolean;
  /** True when called from a resume flow; adapters use this to skip
   *  destructive steps like wiping `.claude/`. */
  isResume: boolean;
}

/**
 * Describes where the user prompt sits in the spawn command line so the
 * Windows .bat shim and stdin-redirection code can find/replace it.
 */
export type PromptHandling =
  /** args[index] is the flag (e.g. "-p"); args[index+1] is the prompt body. */
  | { kind: "flag"; flag: string; index: number }
  /**
   * args[index] is the prompt body. On Windows, the runtime replaces it with
   * "-" and pipes the prompt to stdin to dodge cmd.exe quoting limits.
   */
  | { kind: "positional-stdin"; index: number }
  /** args[index] is the prompt body; no stdin redirection. */
  | { kind: "positional"; index: number };

export interface SpawnPlan {
  /** Absolute path to the CLI binary. */
  cliCmd: string;
  args: string[];
  /** Extra env vars to merge with the runtime's MCP env. */
  extraEnv: Record<string, string>;
  promptHandling: PromptHandling;
}

export interface SpawnCtx {
  projectDir: string;
  prompt: string;
  model?: string;
  reasoningEffort: AgentReasoningEffort;
  customCliPath?: string;
  apiKeys: ApiKeys;
  mcpRunner: string;
  mcpArgs: string[];
  mcpEnv: McpEnv;
  isWin: boolean;
  /** `<projectDir>/.bidwright-mcp-config.json` — already written by runtime. */
  mcpConfigPath: string;
}

export interface ResumeCtx extends SpawnCtx {
  sessionId: string;
}

export interface ParserState {
  toolStartTimes: Map<string, number>;
}

export interface CliAdapter {
  /** Stable id used in settings, API params, and database. */
  readonly id: string;
  /** Human-readable display name (settings UI). */
  readonly displayName: string;
  /** Install hint shown when the binary isn't detected. */
  readonly installHint: string;
  /** Settings key for the CLI-path override (e.g. `claudeCodePath`). */
  readonly pathSettingKey: string;
  /** Default model when none is configured. */
  readonly defaultModel: string;
  /** Filename this CLI canonically reads (used in start-prompt template). */
  readonly primaryInstructionFile: string;
  /** All instruction filenames the generator should write for this CLI. */
  readonly instructionFiles: string[];
  /** Marks adapters that are not yet validated end-to-end in production. */
  readonly experimental?: boolean;

  binaryNames(opts: { isWin: boolean }): string[];
  detect(customPath?: string): CliDetectResult;
  checkAuth(opts: { apiKeys: ApiKeys }): CliAuthStatus;

  /** Heuristic: does this model id belong to this runtime? */
  isCompatibleModel(modelId: string): boolean;
  /** Clamp/normalize a possibly-foreign model id; falls back to defaultModel. */
  normalizeModel(modelId: string | null | undefined): string;
  /** Pull live model list (CLI bundle scrape, RPC, REST API, or static). */
  listModels(opts: { customPath?: string; apiKeys: ApiKeys }): Promise<CliModelOption[]>;

  /**
   * Materialize per-project config files (.claude/settings.json,
   * .codex/config.toml, etc.). Called before every spawn (initial + resume).
   * Adapters return any extra env vars needed (e.g. CODEX_HOME).
   */
  prepareWorkspace(ctx: PrepareWorkspaceCtx): Promise<{ extraEnv?: Record<string, string> }>;

  buildSpawnPlan(ctx: SpawnCtx): Promise<SpawnPlan>;
  buildResumePlan(ctx: ResumeCtx): Promise<SpawnPlan>;
  defaultResumePrompt(): string;

  /** Translate one parsed JSONL line of stdout into normalized SSE events. */
  parseEvent(parsed: any, state: ParserState): SSEEventData[];
  /** Pull the CLI's session id (for --resume) from a parsed JSONL line. */
  extractSessionId(parsed: any): string | null;

  /** True if this stderr line is benign noise the user shouldn't see. */
  isBenignStderr(line: string): boolean;
  /**
   * Optional multi-line stderr suppression (e.g. Codex's HTML stack traces
   * that span many lines after a single trigger).
   */
  shouldSuppressStderrLine?(
    line: string,
    state: { suppressing: boolean },
  ): { suppress: boolean; nextSuppressing: boolean };
}

export interface RegisteredCliAdapter extends CliAdapter {
  /** Order index for UI listing (lower = earlier). */
  order: number;
}
