import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSqlitePersistence } from "../src/infra/persistence/sqlite-store";
import { AccountConfigService } from "../src/core/services/account-config-service";
import { BindCodeService } from "../src/core/services/bind-code-service";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "st-im-bridge-bind-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeService(now: () => number) {
  const dbPath = path.join(tmpDir, "app.db");
  const persistence = createSqlitePersistence(dbPath);
  persistence.accountRepository.ensureSTUserAccount({ handle: "alice", role: "user" });
  const configService = new AccountConfigService(
    persistence.accountRepository,
    persistence.accountConfigRepository,
  );
  const service = new BindCodeService(persistence.bindCodeRepository, configService, { now });
  return { persistence, configService, service };
}

describe("BindCodeService", () => {
  it("generates 6-char codes from the safe alphabet and stores them with TTL", () => {
    let t = 1_000_000;
    const { service, persistence } = makeService(() => t);
    const r1 = service.generate("handle:alice");
    expect(r1.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(new Date(r1.expiresAt).getTime()).toBe(1_000_000 + 5 * 60 * 1000);

    const r2 = service.generate("handle:alice");
    expect(persistence.bindCodeRepository.getByAccount("handle:alice")?.code).toBe(r2.code);
    persistence.close();
  });

  it("redeem succeeds once and adds tg id to allowed list", () => {
    let t = 1_000_000;
    const { service, configService, persistence } = makeService(() => t);
    const { code } = service.generate("handle:alice");
    expect(service.redeem("handle:alice", code, "12345")).toBe("ok");
    const cfg = configService.ensure("handle:alice");
    expect(cfg.telegramAllowedUserIds).toEqual(["12345"]);
    expect(configService.isTelegramUserAllowed("handle:alice", "12345")).toBe(true);

    expect(service.redeem("handle:alice", code, "12345")).toBe("invalid");
    persistence.close();
  });

  it("rejects expired codes with `expired`", () => {
    let t = 1_000_000;
    const { service, persistence } = makeService(() => t);
    const { code } = service.generate("handle:alice");
    t += 5 * 60 * 1000 + 1;
    expect(service.redeem("handle:alice", code, "999")).toBe("expired");
    persistence.close();
  });

  it("locks out a tg user after 10 failures within window", () => {
    let t = 1_000_000;
    const { service, persistence } = makeService(() => t);
    service.generate("handle:alice");
    for (let i = 0; i < 10; i += 1) {
      expect(service.redeem("handle:alice", "WRONG1", "777")).toBe("invalid");
    }
    expect(service.redeem("handle:alice", "WRONG1", "777")).toBe("rate_limited");
    persistence.close();
  });

  it("getActive returns null when no code exists or after expiry", () => {
    let t = 1_000_000;
    const { service, persistence } = makeService(() => t);
    expect(service.getActive("handle:alice")).toBeNull();
    service.generate("handle:alice");
    expect(service.getActive("handle:alice")?.remainingMs).toBeGreaterThan(0);
    t += 5 * 60 * 1000 + 1;
    expect(service.getActive("handle:alice")).toBeNull();
    persistence.close();
  });
});
