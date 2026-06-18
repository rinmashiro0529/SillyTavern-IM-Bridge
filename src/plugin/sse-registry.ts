import type { ServerResponse } from "node:http";
import type { SseResponse } from "../delivery/http/sse/sse-response";

interface RegisteredSse {
  res: ServerResponse;
  sse: SseResponse;
}

export class SseRegistry {
  private readonly active = new Set<RegisteredSse>();

  public register(res: ServerResponse, sse: SseResponse): RegisteredSse {
    const entry: RegisteredSse = { res, sse };
    this.active.add(entry);
    res.on("close", () => this.active.delete(entry));
    res.on("finish", () => this.active.delete(entry));
    return entry;
  }

  public unregister(entry: RegisteredSse): void {
    this.active.delete(entry);
  }

  public async drainAll(timeoutMs: number): Promise<void> {
    if (this.active.size === 0) return;
    for (const entry of this.active) {
      try { entry.sse.end(); } catch { /* swallow */ }
    }
    const deadline = Date.now() + timeoutMs;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.active.clear();
  }
}
