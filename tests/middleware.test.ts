import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { requireSTAdmin, requireSTLogin, requireSelfOrAdmin } from "../src/plugin/middleware";
import type { AccountRepository, STUserAccount } from "../src/core/ports/repositories";

function makeAccountRepo(): AccountRepository {
  const stUsers = new Map<string, STUserAccount>();
  const repo: Partial<AccountRepository> = {
    ensureSTUserAccount: ({ handle, displayName, role }) => {
      const accountId = `handle:${handle}`;
      const acc: STUserAccount = {
        accountId,
        displayName: displayName ?? null,
        createdAt: new Date(0).toISOString(),
        stUserHandle: handle,
        role,
      };
      stUsers.set(accountId, acc);
      return acc;
    },
    getSTUserAccount: (id) => stUsers.get(id) ?? null,
  };
  return repo as AccountRepository;
}

function buildApp(profile: { handle: string; admin: boolean; name?: string } | null) {
  const app = express();
  app.use((req, _res, next) => {
    if (profile) {
      (req as unknown as { user: unknown }).user = { profile };
    }
    next();
  });
  app.use(requireSTLogin(makeAccountRepo()));
  app.get("/me", (req, res) => res.json({ ctx: req.stCtx }));
  app.get("/admin", requireSTAdmin(), (_req, res) => res.json({ ok: true }));
  app.get("/admin/:handle", requireSelfOrAdmin(), (_req, res) => res.json({ ok: true }));
  return app;
}

describe("requireSTLogin", () => {
  it("rejects requests without ST session", async () => {
    const app = buildApp(null);
    const res = await request(app).get("/me");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ST_LOGIN_REQUIRED");
  });

  it("populates stCtx for logged-in users", async () => {
    const app = buildApp({ handle: "alice", admin: false, name: "Alice" });
    const res = await request(app).get("/me");
    expect(res.status).toBe(200);
    expect(res.body.ctx.handle).toBe("alice");
    expect(res.body.ctx.accountId).toBe("handle:alice");
    expect(res.body.ctx.admin).toBe(false);
  });
});

describe("requireSTAdmin", () => {
  it("denies non-admins", async () => {
    const app = buildApp({ handle: "alice", admin: false });
    const res = await request(app).get("/admin");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_REQUIRED");
  });

  it("permits admins", async () => {
    const app = buildApp({ handle: "rin", admin: true });
    const res = await request(app).get("/admin");
    expect(res.status).toBe(200);
  });
});

describe("requireSelfOrAdmin", () => {
  it("denies cross-handle non-admin", async () => {
    const app = buildApp({ handle: "alice", admin: false });
    const res = await request(app).get("/admin/bob");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("permits self", async () => {
    const app = buildApp({ handle: "alice", admin: false });
    const res = await request(app).get("/admin/alice");
    expect(res.status).toBe(200);
  });

  it("permits admin to act on others", async () => {
    const app = buildApp({ handle: "rin", admin: true });
    const res = await request(app).get("/admin/alice");
    expect(res.status).toBe(200);
  });
});
