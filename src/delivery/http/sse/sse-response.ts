import type { ServerResponse } from "node:http";
import { formatSseEvent } from "./sse-events";

export class SseResponse {
  private readonly response: ServerResponse;
  private closed = false;

  public constructor(response: ServerResponse) {
    this.response = response;
    this.response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    this.response.write("\n");
  }

  public send(event: string, data: unknown): void {
    if (this.closed) {
      return;
    }

    this.response.write(formatSseEvent(event, data));
  }

  public end(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.response.end();
  }
}
