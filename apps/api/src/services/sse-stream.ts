/**
 * SSE (Server-Sent Events) stream helper for Fastify.
 * Wraps a Fastify reply with proper SSE headers and event sending.
 */

import type { FastifyReply } from "fastify";

export interface SSEEvent {
  type: "thinking" | "tool_call" | "tool_result" | "message" | "progress" | "error" | "status" | "file_read";
  data: unknown;
}

export class SSEStream {
  private reply: FastifyReply;
  private closed = false;
  private keepAliveTimer: ReturnType<typeof setInterval>;

  constructor(reply: FastifyReply) {
    this.reply = reply;

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    // Keep-alive ping every 15s
    this.keepAliveTimer = setInterval(() => {
      if (!this.closed) {
        this.reply.raw.write(": ping\n\n");
      }
    }, 15_000);

    // Cleanup on client disconnect
    reply.raw.on("close", () => {
      this.closed = true;
      clearInterval(this.keepAliveTimer);
    });
  }

  /** Send a typed SSE event */
  send(event: SSEEvent): void {
    if (this.closed) return;
    const payload = JSON.stringify(event.data);
    this.reply.raw.write(`event: ${event.type}\ndata: ${payload}\n\n`);
  }

  /** Send a generic data-only SSE message (no event type) */
  sendData(data: unknown): void {
    if (this.closed) return;
    this.reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /** Check if the connection is still open */
  get isOpen(): boolean {
    return !this.closed;
  }

  /** Close the stream */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.keepAliveTimer);
    this.reply.raw.end();
  }
}
