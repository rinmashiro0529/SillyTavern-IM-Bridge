import type { Request, Response, NextFunction, RequestHandler } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export function createRateLimiter(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.stCtx?.handle ?? req.ip ?? "unknown";
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }
    if (bucket.count >= options.max) {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "请求过于频繁" } });
      return;
    }
    bucket.count += 1;
    next();
  };
}
