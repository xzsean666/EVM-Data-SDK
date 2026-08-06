import { invalidConfiguration } from "../domain/errors";

export type ParsedSingBoxProxy = ParsedVlessProxy | ParsedShadowsocksProxy;

export interface ParsedVlessProxy {
  readonly kind: "vless";
  readonly server: string;
  readonly serverPort: number;
  readonly uuid: string;
  readonly security: "none" | "tls" | "reality";
  readonly transport: "tcp" | "ws" | "grpc" | "httpupgrade";
  readonly sni: string | null;
  readonly fingerprint: string | null;
  readonly realityPublicKey: string | null;
  readonly realityShortId: string | null;
  readonly flow: string | null;
  readonly path: string | null;
  readonly host: string | null;
  readonly serviceName: string | null;
  readonly alpn: readonly string[];
  readonly allowInsecure: boolean;
}

export interface ParsedShadowsocksProxy {
  readonly kind: "shadowsocks";
  readonly server: string;
  readonly serverPort: number;
  readonly method: string;
  readonly password: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const vlessParameterNames = new Set([
  "security", "type", "sni", "fp", "pbk", "sid", "flow", "path", "host",
  "serviceName", "alpn", "allowInsecure", "encryption",
]);
const shadowsocksMethods = new Set([
  "aes-128-gcm", "aes-256-gcm", "chacha20-ietf-poly1305",
  "2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
]);

export function parseSingBoxProxyUrl(value: string): ParsedSingBoxProxy {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidConfiguration("Advanced proxy URL is invalid.");
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === "vless") return parseVless(url);
  if (scheme === "ss") return parseShadowsocks(value, url);
  throw invalidConfiguration("Advanced proxy URL must use the VLESS or Shadowsocks scheme.");
}

export function parseSingBoxProxyUrls(values: readonly string[]): readonly ParsedSingBoxProxy[] {
  return Object.freeze(values.map((value) => parseSingBoxProxyUrl(value)));
}

function parseVless(url: URL): ParsedVlessProxy {
  for (const key of url.searchParams.keys()) {
    if (!vlessParameterNames.has(key)) throw invalidConfiguration("Advanced proxy URL contains an unsupported VLESS parameter.");
  }
  const uuid = decode(url.username);
  if (!uuidPattern.test(uuid)) throw invalidConfiguration("Advanced proxy VLESS UUID is invalid.");
  const server = normalizeHost(url.hostname);
  const serverPort = parsePort(url.port);
  const security = enumValue(url.searchParams.get("security") ?? "none", ["none", "tls", "reality"] as const);
  const transport = enumValue(url.searchParams.get("type") ?? "tcp", ["tcp", "ws", "grpc", "httpupgrade"] as const);
  const encryption = url.searchParams.get("encryption");
  if (encryption !== null && encryption !== "none") throw invalidConfiguration("Advanced proxy VLESS encryption is unsupported.");
  const sni = optionalText(url.searchParams.get("sni"));
  const fingerprint = optionalText(url.searchParams.get("fp"));
  const realityPublicKey = optionalText(url.searchParams.get("pbk"));
  const realityShortId = optionalText(url.searchParams.get("sid"));
  const flow = optionalText(url.searchParams.get("flow"));
  const path = optionalPath(url.searchParams.get("path"));
  const host = optionalHost(url.searchParams.get("host"));
  const serviceName = optionalText(url.searchParams.get("serviceName"));
  const alpn = parseAlpn(url.searchParams.get("alpn"));
  const allowInsecure = parseBoolean(url.searchParams.get("allowInsecure"));

  if (security === "reality" && (sni === null || fingerprint === null || realityPublicKey === null)) {
    throw invalidConfiguration("Advanced proxy Reality requires SNI, fingerprint, and public key.");
  }
  if (security === "none" && (sni !== null || fingerprint !== null || realityPublicKey !== null || realityShortId !== null || allowInsecure)) {
    throw invalidConfiguration("Advanced proxy VLESS security parameters are incompatible with security=none.");
  }
  if (flow !== null && (transport !== "tcp" || flow !== "xtls-rprx-vision")) {
    throw invalidConfiguration("Advanced proxy VLESS flow is unsupported for this transport.");
  }
  if (transport === "ws" && path === null) {
    throw invalidConfiguration("Advanced proxy WebSocket transport requires a path.");
  }
  if (transport === "grpc" && serviceName === null) {
    throw invalidConfiguration("Advanced proxy gRPC transport requires a service name.");
  }
  if (transport === "httpupgrade" && path === null) {
    throw invalidConfiguration("Advanced proxy HTTPUpgrade transport requires a path.");
  }
  if (transport !== "ws" && host !== null) {
    throw invalidConfiguration("Advanced proxy host is supported only for WebSocket transport.");
  }
  if (transport !== "grpc" && serviceName !== null) {
    throw invalidConfiguration("Advanced proxy service name is supported only for gRPC transport.");
  }
  return Object.freeze({
    kind: "vless", server, serverPort, uuid, security, transport, sni,
    fingerprint, realityPublicKey, realityShortId, flow, path, host,
    serviceName, alpn: Object.freeze(alpn), allowInsecure,
  });
}

function parseShadowsocks(raw: string, url: URL): ParsedShadowsocksProxy {
  if (url.searchParams.has("plugin")) throw invalidConfiguration("Advanced proxy Shadowsocks plugins are unsupported.");
  let method: string;
  let password: string;
  let server: string;
  let serverPort: number;
  try {
    const authority = raw.slice(raw.indexOf("://") + 3).split(/[?#]/, 1)[0] ?? "";
    // The original URI form encodes the whole method:password@authority
    // tuple. URL parses that opaque base64 text as a hostname, so it must be
    // identified before applying the SIP002 userinfo form below.
    if (!authority.includes("@")) {
      const decoded = decodeBase64(authority);
      const at = decoded.lastIndexOf("@");
      const methodSeparator = decoded.indexOf(":");
      if (at < 1 || methodSeparator < 1 || methodSeparator >= at) throw new Error("invalid authority");
      method = decoded.slice(0, methodSeparator).toLowerCase();
      password = decoded.slice(methodSeparator + 1, at);
      const authorityUrl = new URL("ss://" + decoded.slice(at + 1));
      server = normalizeHost(authorityUrl.hostname);
      serverPort = parsePort(authorityUrl.port);
    } else if (url.hostname !== "") {
      const user = decode(url.username);
      const userPassword = decode(url.password);
      const decodedUser = user.includes(":") ? user : decodeBase64(user);
      const separator = decodedUser.indexOf(":");
      if (separator < 1) throw new Error("missing method");
      method = decodedUser.slice(0, separator).toLowerCase();
      password = decodedUser.slice(separator + 1) || userPassword;
      server = normalizeHost(url.hostname);
      serverPort = parsePort(url.port);
    } else throw new Error("missing authority");
  } catch {
    throw invalidConfiguration("Advanced proxy Shadowsocks URL is invalid.");
  }
  if (!shadowsocksMethods.has(method) || password.length === 0 || password.length > 1024) {
    throw invalidConfiguration("Advanced proxy Shadowsocks cipher or password is invalid.");
  }
  return Object.freeze({ kind: "shadowsocks", server, serverPort, method, password });
}

function normalizeHost(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 253 || /[\s/?#@]/.test(normalized)) {
    throw invalidConfiguration("Advanced proxy host is invalid.");
  }
  return normalized;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw invalidConfiguration("Advanced proxy port is invalid.");
  return port;
}

function enumValue<T extends readonly string[]>(value: string, values: T): T[number] {
  if (!(values as readonly string[]).includes(value)) throw invalidConfiguration("Advanced proxy URL contains an unsupported value.");
  return value as T[number];
}

function optionalText(value: string | null): string | null {
  if (value === null || value === "") return null;
  const decoded = decode(value);
  if (decoded.length > 512 || /[\r\n]/.test(decoded)) throw invalidConfiguration("Advanced proxy URL parameter is invalid.");
  return decoded;
}

function optionalPath(value: string | null): string | null {
  const text = optionalText(value);
  if (text === null) return null;
  return text.startsWith("/") ? text : "/" + text;
}

function optionalHost(value: string | null): string | null {
  const text = optionalText(value);
  return text === null ? null : normalizeHost(text);
}

function parseAlpn(value: string | null): readonly string[] {
  if (value === null || value === "") return [];
  const values = value.split(",").map((entry) => decode(entry).trim()).filter((entry) => entry.length > 0);
  if (values.length === 0 || values.length > 8 || values.some((entry) => entry.length > 64 || /[\s,]/.test(entry))) {
    throw invalidConfiguration("Advanced proxy ALPN value is invalid.");
  }
  return values;
}

function parseBoolean(value: string | null): boolean {
  if (value === null || value === "" || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw invalidConfiguration("Advanced proxy boolean parameter is invalid.");
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalidConfiguration("Advanced proxy URL encoding is invalid.");
  }
}

function decodeBase64(value: string): string {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) throw new Error("invalid base64");
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  if (decoded.length === 0 || decoded.includes("\u0000")) throw new Error("invalid base64");
  return decoded;
}
