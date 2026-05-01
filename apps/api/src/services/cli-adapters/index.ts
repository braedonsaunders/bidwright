/**
 * CLI adapter bootstrap. Importing this module registers every adapter
 * into the registry; downstream code can then look them up by id.
 */

import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { geminiAdapter } from "./gemini.js";
import { opencodeAdapter } from "./opencode.js";
import { registerAdapter } from "./registry.js";

registerAdapter(claudeCodeAdapter);
registerAdapter(codexAdapter);
registerAdapter(opencodeAdapter);
registerAdapter(geminiAdapter);

export {
  getAdapter,
  isRegisteredRuntime,
  listAdapterIds,
  listAdapters,
  tryGetAdapter,
} from "./registry.js";
export type {
  AgentReasoningEffort,
  ApiKeys,
  CliAdapter,
  CliAuthStatus,
  CliDetectResult,
  CliModelOption,
  McpEnv,
  ParserState,
  PrepareWorkspaceCtx,
  PromptHandling,
  RegisteredCliAdapter,
  ResumeCtx,
  SSEEventData,
  SpawnCtx,
  SpawnPlan,
} from "./types.js";
