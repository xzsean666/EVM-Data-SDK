import { describe, expect, it } from "vitest";

import { CredentialPool } from "../../src/execution/CredentialPool";
import type { Clock } from "../../src/execution/clock";
import { ProxyPool } from "../../src/execution/ProxyPool";

class FakeClock implements Clock {
  current = 0;

  now(): number {
    return this.current;
  }

  advance(value: number): void {
    this.current += value;
  }
}

describe("CredentialPool", () => {
  it("leases credentials fairly and never duplicates an active lease", () => {
    const clock = new FakeClock();
    const pool = new CredentialPool(["key-a", "key-b"], {
      providerConfigurationId: "etherscan-main",
      clock,
    });

    const first = pool.acquire();
    const second = pool.acquire();
    expect(first?.id).toBe("etherscan-main-key-1");
    expect(second?.id).toBe("etherscan-main-key-2");
    expect(pool.acquire()).toBeNull();

    if (first === null || second === null) {
      throw new Error("Expected two credential leases.");
    }
    pool.report(first, "success");
    pool.report(second, "success");
    expect(pool.acquire()?.id).toBe("etherscan-main-key-1");
  });

  it("disables invalid credentials and cools down rate-limited credentials", () => {
    const clock = new FakeClock();
    const pool = new CredentialPool(["key-a", "key-b"], { clock, rateCooldownMs: 100 });
    const first = pool.acquire();
    if (first === null) {
      throw new Error("Expected a credential lease.");
    }
    pool.report(first, "authentication_failed");
    expect(pool.state(first.id)).toMatchObject({ disabled: true, leased: false });

    const second = pool.acquire();
    if (second === null) {
      throw new Error("Expected the second credential lease.");
    }
    pool.report(second, "rate_limited");
    expect(pool.acquire()).toBeNull();
    expect(pool.nextAvailableAt()).toBe(100);
    clock.advance(100);
    expect(pool.acquire()?.id).toBe(second.id);
  });

  it("does not expose secret values in state snapshots", () => {
    const pool = new CredentialPool(["credential-secret"], { providerConfigurationId: "provider" });
    const lease = pool.acquire();
    expect(lease?.value).toBe("credential-secret");
    expect(JSON.stringify(pool.state("provider-key-1"))).not.toContain("credential-secret");
  });

  it("ignores stale outcome reports after a lease is reissued", () => {
    const pool = new CredentialPool(["key-a"]);
    const first = pool.acquire();
    if (first === null) {
      throw new Error("Expected the first credential lease.");
    }
    pool.report(first, "success");
    const second = pool.acquire();
    if (second === null) {
      throw new Error("Expected the second credential lease.");
    }
    pool.report(first, "authentication_failed");
    expect(pool.state(second.id)?.disabled).toBe(false);
    pool.report(second, "authentication_failed");
    expect(pool.state(second.id)?.disabled).toBe(true);
  });
});

describe("ProxyPool", () => {
  it("rotates proxies fairly and cools down only proxy failures", () => {
    const clock = new FakeClock();
    const pool = new ProxyPool(["http://proxy-a:8080", "http://proxy-b:8080"], {
      allowDirect: false,
      clock,
      cooldownMs: 100,
    });
    const first = pool.acquire();
    const second = pool.acquire();
    expect(first?.id).toBe("proxy-1");
    expect(second?.id).toBe("proxy-2");
    expect(pool.acquire()).toBeUndefined();

    if (first === undefined || first === null || second === undefined || second === null) {
      throw new Error("Expected two proxy leases.");
    }
    pool.report(first, "proxy_failure");
    pool.report(second, "neutral");
    expect(pool.state(first.id)).toMatchObject({ cooldownUntil: 100 });
    expect(pool.acquire()?.id).toBe("proxy-2");
    clock.advance(100);
    expect(pool.acquire()?.id).toBe("proxy-1");
  });

  it("makes direct routing explicit", () => {
    expect(new ProxyPool([], { allowDirect: true }).acquire()).toBeNull();
    expect(new ProxyPool([], { allowDirect: false }).acquire()).toBeUndefined();
  });

  it("rejects proxy URLs that transport cannot safely parse", () => {
    expect(() => new ProxyPool(["http://proxy.example:8080/path"], { allowDirect: false })).toThrow(
      "without a path",
    );
  });

  it("round-robins direct and configured proxy routes when direct is allowed", () => {
    const pool = new ProxyPool(["http://proxy-a:8080", "http://proxy-b:8080"], { allowDirect: true });
    const first = pool.acquire();
    expect(first?.id).toBe("proxy-1");
    if (first === null || first === undefined) throw new Error("Expected a proxy lease.");
    pool.report(first, "success");
    const second = pool.acquire();
    expect(second?.id).toBe("proxy-2");
    if (second === null || second === undefined) throw new Error("Expected a proxy lease.");
    pool.report(second, "success");
    expect(pool.acquire()).toBeNull();
  });
});
