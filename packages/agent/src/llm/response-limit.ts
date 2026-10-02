/** A recoverable response boundary. Partial tool calls must never be executed. */
export class ResponseLimitError extends Error {
  constructor() {
    super("The AI response reached its token budget before completing the CAD program.");
    this.name = "ResponseLimitError";
  }
}
