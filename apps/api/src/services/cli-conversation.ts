export type CliConversationEvent = {
  type?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
};

export type CliConversationRun = {
  input?: unknown;
  output?: unknown;
};

function eventText(event: CliConversationEvent): string {
  const content = event.data?.content;
  return typeof content === "string" ? content.trim() : "";
}

function eventRole(event: CliConversationEvent): string {
  return typeof event.data?.role === "string" ? event.data.role : "";
}

export function readConversationEvents(run: CliConversationRun | null | undefined): CliConversationEvent[] {
  const events = (run?.output as { events?: unknown } | null)?.events;
  return Array.isArray(events) ? events as CliConversationEvent[] : [];
}

/**
 * A successful process exit is not a successful chat turn unless the runtime
 * produced an assistant answer after its final tool interaction. This catches
 * the common failure mode where an agent says "I'll look that up", calls a
 * tool, and then exits without ever answering the user.
 */
export function hasFinalAssistantAnswer(events: CliConversationEvent[]): boolean {
  let lastToolIndex = -1;
  let lastAssistantIndex = -1;

  events.forEach((event, index) => {
    if (event.type === "tool_call" || event.type === "tool" || event.type === "tool_result") {
      lastToolIndex = index;
    }
    if (event.type === "message" && eventRole(event) === "assistant" && eventText(event)) {
      lastAssistantIndex = index;
    }
  });

  return lastAssistantIndex >= 0 && lastAssistantIndex > lastToolIndex;
}

function inputPrompt(run: CliConversationRun): string {
  const input = run.input && typeof run.input === "object"
    ? run.input as Record<string, unknown>
    : {};
  return typeof input.prompt === "string" ? input.prompt.trim() : "";
}

function finalAssistantAnswer(events: CliConversationEvent[]): string {
  if (!hasFinalAssistantAnswer(events)) return "";
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "message" && eventRole(event) === "assistant") {
      const content = eventText(event);
      if (content) return content;
    }
  }
  return "";
}

function userQuestion(run: CliConversationRun, events: CliConversationEvent[]): string {
  const event = events.find((candidate) =>
    candidate.type === "message" && eventRole(candidate) === "user" && eventText(candidate),
  );
  return event ? eventText(event) : inputPrompt(run);
}

/**
 * Build provider-neutral, mode-scoped conversation context from persisted
 * runs. New sessions therefore retain useful follow-up context even after a
 * server restart or when a tenant changes runtime/provider between turns.
 */
export function buildModeConversationContext(
  runsNewestFirst: CliConversationRun[],
  maxChars = 12_000,
): string {
  const turns = runsNewestFirst
    .slice()
    .reverse()
    .map((run) => {
      const events = readConversationEvents(run);
      return {
        user: userQuestion(run, events),
        assistant: finalAssistantAnswer(events),
      };
    })
    .filter((turn) => turn.user || turn.assistant);

  const retained: string[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const block = [
      turn.user ? `User: ${turn.user}` : "",
      turn.assistant ? `Assistant: ${turn.assistant}` : "",
    ].filter(Boolean).join("\n");
    if (!block) continue;
    if (used > 0 && used + block.length + 2 > maxChars) break;
    const available = Math.max(0, maxChars - used);
    retained.unshift(block.length > available ? block.slice(block.length - available) : block);
    used += Math.min(block.length, available) + (retained.length > 1 ? 2 : 0);
    if (used >= maxChars) break;
  }

  return retained.join("\n\n");
}

