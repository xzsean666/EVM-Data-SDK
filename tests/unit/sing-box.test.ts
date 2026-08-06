import { describe, expect, it } from "vitest";

import { parseClientConfiguration } from "../../src/domain/configuration";
import { buildSingBoxConfig } from "../../src/proxy/SingBoxConfigBuilder";
import { SingBoxProxyManager } from "../../src/proxy/SingBoxProxyManager";
import { parseSingBoxProxyUrl } from "../../src/proxy/SingBoxUrlParser";
import type { SingBoxBinaryManager } from "../../src/proxy/SingBoxBinaryManager";
import type { SingBoxRuntime } from "../../src/proxy/SingBoxRuntime";

const vless = "vless://123e4567-e89b-42d3-a456-426614174000@proxy.example:443?encryption=none&security=tls&sni=origin.example&type=ws&path=%2Fsocket&host=origin.example#private-label";

describe("sing-box proxy configuration", () => {
  it("parses supported VLESS and Shadowsocks URLs into immutable structured nodes", () => {
    const parsedVless = parseSingBoxProxyUrl(vless);
    const parsedShadowsocks = parseSingBoxProxyUrl("ss://YWVzLTI1Ni1nY206c2VjcmV0QHByb3h5LmV4YW1wbGU6ODM4OA");

    expect(parsedVless).toMatchObject({ kind: "vless", server: "proxy.example", security: "tls", transport: "ws", path: "/socket" });
    expect(parsedShadowsocks).toMatchObject({ kind: "shadowsocks", method: "aes-256-gcm", server: "proxy.example", serverPort: 8388 });
    expect(Object.isFrozen(parsedVless)).toBe(true);
  });

  it("rejects unsupported proxy syntax without reflecting proxy credentials", () => {
    const error = (() => {
      try {
        parseSingBoxProxyUrl("vless://not-a-uuid:private-password@proxy.example:443?security=none");
      } catch (value: unknown) {
        return value;
      }
      throw new Error("Expected invalid VLESS URL to be rejected.");
    })();
    expect(error).toMatchObject({ code: "INVALID_CONFIGURATION" });
    expect((error as Error).message).not.toContain("private-password");
    expect(() => parseSingBoxProxyUrl("ss://YWVzLTI1Ni1nY206c2VjcmV0QHByb3h5LmV4YW1wbGU6ODM4OA?plugin=obfs-local")).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("renders only a loopback mixed inbound and controlled outbounds", () => {
    const config = buildSingBoxConfig([parseSingBoxProxyUrl(vless)], 3128);
    expect(config.inbounds).toEqual([expect.objectContaining({ type: "mixed", listen: "127.0.0.1", listen_port: 3128 })]);
    expect(config.route).toEqual({ final: "sdk-selector" });
    expect(JSON.stringify(config)).not.toContain("private-label");
  });

  it("requires initialization for eager mode and presents one local HTTP lease afterwards", async () => {
    const configuration = parseClientConfiguration({
      providers: [{ kind: "alchemy", apiKeys: ["key"] }],
      advancedProxy: { kind: "sing-box", urls: [vless], singBox: { downloadMode: "eager" } },
    }).advancedProxy;
    if (configuration === undefined) throw new Error("Expected normalized advanced proxy configuration.");
    let closed = 0;
    const runtime = {
      start: async () => "http://127.0.0.1:3128",
      close: async () => { closed += 1; },
    } as unknown as SingBoxRuntime;
    const binaryManager = { resolve: async () => "/trusted/sing-box" } as unknown as SingBoxBinaryManager;
    const manager = new SingBoxProxyManager(configuration, { binaryManager, createRuntime: () => runtime });

    expect(() => manager.assertReady()).toThrowError(expect.objectContaining({ code: "PROXY_NOT_READY" }));
    await manager.initialize();
    await expect(manager.acquire()).resolves.toMatchObject({ id: "sing-box-loopback", url: "http://127.0.0.1:3128" });
    await manager.close();
    await manager.close();
    expect(closed).toBe(1);
  });
});
