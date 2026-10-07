export interface QuestionHistoryEvent {
  type?: string;
  data?: unknown;
  timestamp?: string;
}

function dataOf(event: QuestionHistoryEvent): Record<string, unknown> {
  return event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
}

function idOf(event: QuestionHistoryEvent): string {
  const data = dataOf(event);
  return typeof data.questionId === "string" ? data.questionId : typeof data.id === "string" ? data.id : "";
}

/**
 * Question and runtime events have independent writers. Persistence order can
 * differ from occurrence order. Only an explicit answer/timeout resolves a
 * question: buffered calls, progress, token usage, and parallel work do not.
 */
export function findPendingQuestionEvent<T extends QuestionHistoryEvent>(events: T[], questionId?: string): T | null {
  const resolvedIds = new Set(events
    .filter((event) => event.type === "userAnswer" || event.type === "askUserTimeout")
    .map(idOf).filter(Boolean));
  const ordered = events.map((event, index) => ({ event, index, time: Date.parse(event.timestamp || "") }));
  if (ordered.every((entry) => Number.isFinite(entry.time))) ordered.sort((a, b) => a.time - b.time || a.index - b.index);
  let pending: T | null = null;
  for (const { event } of ordered) {
    const id = idOf(event);
    if (event.type === "askUser") {
      if (questionId && id !== questionId) continue;
      pending = resolvedIds.has(id) ? null : event;
    } else if ((event.type === "userAnswer" || event.type === "askUserTimeout") && !id) {
      // Older persisted events did not always include a question id.
      pending = null;
    }
  }
  return pending;
}
