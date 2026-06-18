import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { AccountRepository } from "../core/ports/repositories";
import type { AccountRole } from "../core/ports/repositories";

export interface STUserContext {
  handle: string;
  admin: boolean;
  accountId: string;
  displayName: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    stCtx?: STUserContext;
  }
}

interface StProfileLike {
  handle?: unknown;
  name?: unknown;
  admin?: unknown;
}

function readSTProfile(req: Request): StProfileLike | null {
  const user = (req as unknown as { user?: { profile?: unknown } }).user;
  if (!user || typeof user !== "object") return null;
  const profile = (user as { profile?: unknown }).profile;
  if (!profile || typeof profile !== "object") return null;
  return profile as StProfileLike;
}

export function requireSTLogin(accountRepo: AccountRepository): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const profile = readSTProfile(req);
    const handleRaw = profile?.handle;
    if (typeof handleRaw !== "string" || !handleRaw.trim()) {
      res.status(403).json({ error: { code: "ST_LOGIN_REQUIRED", message: "需要 SillyTavern 登录" } });
      return;
    }
    const handle = handleRaw.trim();
    const admin = Boolean(profile?.admin);
    const role: AccountRole = admin ? "admin" : "user";
    const displayName = typeof profile?.name === "string" ? profile.name : null;
    const account = accountRepo.ensureSTUserAccount({ handle, displayName, role });
    req.stCtx = {
      handle,
      admin,
      accountId: account.accountId,
      displayName: account.displayName,
    };
    next();
  };
}

export function requireSTAdmin(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.stCtx) {
      res.status(403).json({ error: { code: "ST_LOGIN_REQUIRED", message: "需要 SillyTavern 登录" } });
      return;
    }
    if (!req.stCtx.admin) {
      res.status(403).json({ error: { code: "ADMIN_REQUIRED", message: "仅管理员可执行该操作" } });
      return;
    }
    next();
  };
}

export function requireSelfOrAdmin(paramName = "handle"): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.stCtx) {
      res.status(403).json({ error: { code: "ST_LOGIN_REQUIRED", message: "需要 SillyTavern 登录" } });
      return;
    }
    if (req.stCtx.admin) {
      next();
      return;
    }
    if (req.params[paramName] === req.stCtx.handle) {
      next();
      return;
    }
    res.status(403).json({ error: { code: "FORBIDDEN", message: "只能操作本人账号" } });
  };
}
