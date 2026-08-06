import { EvmDataError } from "../domain/errors";
import type { ParsedSingBoxProxy } from "./SingBoxUrlParser";

export interface SingBoxConfig {
  readonly log: { readonly level: "error" };
  readonly inbounds: readonly Record<string, unknown>[];
  readonly outbounds: readonly Record<string, unknown>[];
  readonly route: { readonly final: string };
}

export function buildSingBoxConfig(
  nodes: readonly ParsedSingBoxProxy[],
  localPort: number,
): SingBoxConfig {
  if (nodes.length === 0 || !Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) {
    throw new EvmDataError({ code: "SING_BOX_CONFIG_INVALID", message: "The managed proxy configuration is invalid.", retryable: false });
  }
  const nodeOutbounds = nodes.map((node, index) => buildOutbound(node, "sdk-node-" + String(index + 1)));
  const selector = {
    type: "urltest",
    tag: "sdk-selector",
    outbounds: nodeOutbounds.map((node) => String(node.tag)),
    url: "https://www.gstatic.com/generate_204",
    interval: "10m",
    tolerance: 50,
  };
  return Object.freeze({
    log: Object.freeze({ level: "error" as const }),
    inbounds: Object.freeze([Object.freeze({
      type: "mixed",
      tag: "sdk-inbound",
      listen: "127.0.0.1",
      listen_port: localPort,
    })]),
    outbounds: Object.freeze([...nodeOutbounds, Object.freeze(selector), Object.freeze({
      type: "block",
      tag: "sdk-block",
    })]),
    route: Object.freeze({ final: "sdk-selector" }),
  });
}

function buildOutbound(node: ParsedSingBoxProxy, tag: string): Record<string, unknown> {
  if (node.kind === "shadowsocks") {
    return Object.freeze({
      type: "shadowsocks",
      tag,
      server: node.server,
      server_port: node.serverPort,
      method: node.method,
      password: node.password,
    });
  }
  const outbound: Record<string, unknown> = {
    type: "vless",
    tag,
    server: node.server,
    server_port: node.serverPort,
    uuid: node.uuid,
  };
  if (node.flow !== null) outbound.flow = node.flow;
  if (node.security !== "none") {
    const tls: Record<string, unknown> = {
      enabled: true,
      server_name: node.sni ?? node.server,
      insecure: node.allowInsecure,
    };
    if (node.alpn.length > 0) tls.alpn = [...node.alpn];
    if (node.fingerprint !== null) tls.utls = { enabled: true, fingerprint: node.fingerprint };
    if (node.security === "reality") {
      tls.reality = {
        enabled: true,
        public_key: node.realityPublicKey,
        short_id: node.realityShortId ?? "",
      };
    }
    outbound.tls = tls;
  }
  if (node.transport === "ws") {
    outbound.transport = { type: "ws", path: node.path ?? "/", headers: node.host === null ? {} : { Host: node.host } };
  } else if (node.transport === "grpc") {
    outbound.transport = { type: "grpc", service_name: node.serviceName ?? "" };
  } else if (node.transport === "httpupgrade") {
    outbound.transport = { type: "httpupgrade", path: node.path ?? "/", host: node.host ?? node.server };
  }
  return Object.freeze(outbound);
}
