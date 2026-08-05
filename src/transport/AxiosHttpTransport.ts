import axios, {
  type AxiosInstance,
  type AxiosProxyConfig,
  type AxiosRequestConfig,
  isAxiosError,
} from "axios";

import {
  HttpTransportError,
  type HttpProxy,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from "./HttpTransport";
import {
  redactAxiosError,
  redactMessage,
} from "./redaction";

export interface AxiosHttpTransportOptions {
  readonly axiosInstance?: AxiosInstance;
}

export class AxiosHttpTransport implements HttpTransport {
  private readonly client: AxiosInstance;

  constructor(options: AxiosHttpTransportOptions = {}) {
    this.client = options.axiosInstance ?? axios.create();
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    validateRequest(request);
    const knownSecrets = collectRequestSecrets(request);

    if (request.signal?.aborted === true) {
      throw new HttpTransportError({
        code: "REQUEST_ABORTED",
        message: "HTTP request was aborted.",
        retryable: false,
      });
    }

    const config: AxiosRequestConfig = {
      method: request.method,
      url: request.url,
      timeout: request.timeoutMs,
      proxy: request.proxy === null || request.proxy === undefined ? false : toAxiosProxy(request.proxy),
      maxRedirects: 0,
      validateStatus: () => true,
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(request.params === undefined ? {} : { params: request.params }),
      ...(request.body === undefined ? {} : { data: request.body }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    };

    try {
      const response = await this.client.request(config);
      if (request.proxy !== null && request.proxy !== undefined && response.status === 407) {
        throw new HttpTransportError({
          code: "PROXY_ERROR",
          message: "HTTP request failed at the proxy boundary.",
          retryable: true,
          status: response.status,
        });
      }
      return {
        status: response.status,
        headers: normalizeHeaders(response.headers),
        body: response.data,
      };
    } catch (error: unknown) {
      if (error instanceof HttpTransportError) {
        throw error;
      }
      throw normalizeAxiosError(error, request, knownSecrets);
    }
  }
}

export function parseHttpProxyUrl(value: string): HttpProxy {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpTransportError({
      code: "INVALID_REQUEST",
      message: "Proxy URL must be a valid HTTP(S) URL.",
      retryable: false,
    });
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname.length === 0 ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new HttpTransportError({
      code: "INVALID_REQUEST",
      message: "Proxy URL must use HTTP(S) without a path, query, or fragment.",
      retryable: false,
    });
  }

  const port = parsed.port === "" ? (parsed.protocol === "https:" ? 443 : 80) : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new HttpTransportError({
      code: "INVALID_REQUEST",
      message: "Proxy URL contains an invalid port.",
      retryable: false,
    });
  }

  const auth = parsed.username === "" && parsed.password === ""
    ? undefined
    : {
        username: decodeProxyCredential(parsed.username),
        password: decodeProxyCredential(parsed.password),
      };

  return {
    protocol: parsed.protocol === "https:" ? "https" : "http",
    host: parsed.hostname,
    port,
    ...(auth === undefined ? {} : { auth }),
  };
}

export function normalizeAxiosError(
  error: unknown,
  request: HttpRequest,
  knownSecrets: readonly string[] = [],
): HttpTransportError {
  const cause = redactAxiosError(error, { knownSecrets });
  const message = isAxiosError(error) ? error.message : error instanceof Error ? error.message : "Unknown HTTP failure.";
  const code = isAxiosError(error) ? error.code : undefined;
  const status = isAxiosError(error) ? error.response?.status ?? null : null;

  if (request.signal?.aborted === true || code === "ERR_CANCELED") {
    return new HttpTransportError({
      code: "REQUEST_ABORTED",
      message: "HTTP request was aborted.",
      retryable: false,
      status,
      cause,
    });
  }

  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test(message)) {
    return new HttpTransportError({
      code: "REQUEST_TIMEOUT",
      message: "HTTP request timed out.",
      retryable: true,
      status,
      cause,
    });
  }

  if (request.proxy !== null && request.proxy !== undefined && isProxyFailure(message, code, status)) {
    return new HttpTransportError({
      code: "PROXY_ERROR",
      message: "HTTP request failed at the proxy boundary.",
      retryable: true,
      status,
      cause,
    });
  }

  return new HttpTransportError({
    code: "NETWORK_ERROR",
    message: `HTTP request failed at the network boundary: ${redactMessage(message, { knownSecrets })}`,
    retryable: true,
    status,
    cause,
  });
}

function validateRequest(request: HttpRequest): void {
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    throw new HttpTransportError({
      code: "INVALID_REQUEST",
      message: "HTTP request URL must be valid.",
      retryable: false,
    });
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new HttpTransportError({
      code: "INVALID_REQUEST",
      message: "HTTP request URL must use HTTP(S) without userinfo.",
      retryable: false,
    });
  }
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs <= 0 || request.timeoutMs > 86_400_000) {
    throw new HttpTransportError({
      code: "INVALID_REQUEST",
      message: "HTTP request timeout must be a positive bounded integer.",
      retryable: false,
    });
  }
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
      throw new HttpTransportError({
        code: "INVALID_REQUEST",
        message: "HTTP request headers must not contain line breaks.",
        retryable: false,
      });
    }
  }
}

function collectRequestSecrets(request: HttpRequest): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (/authorization|api[-_]?key|token|password|secret|credential/i.test(key)) {
      values.push(value);
      values.push(...value.split(/\s+/));
    }
  }
  for (const [key, value] of Object.entries(request.params ?? {})) {
    if (typeof value === "string" && /apikey|api[-_]?key|token|password|secret|credential|pagekey/i.test(key)) {
      values.push(value);
    }
  }
  if (request.proxy?.auth !== undefined) {
    values.push(request.proxy.auth.username, request.proxy.auth.password);
  }
  return values;
}

function normalizeHeaders(headers: unknown): Record<string, string | readonly string[]> {
  const result: Record<string, string | readonly string[]> = {};
  if (headers === null || typeof headers !== "object") {
    return result;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      result[key] = value.map((entry) => String(entry));
    } else if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}

function toAxiosProxy(proxy: HttpProxy): AxiosProxyConfig {
  return {
    protocol: proxy.protocol,
    host: proxy.host,
    port: proxy.port,
    ...(proxy.auth === undefined ? {} : { auth: proxy.auth }),
  };
}

function decodeProxyCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpTransportError({
      code: "INVALID_REQUEST",
      message: "Proxy credentials are not valid URL encoding.",
      retryable: false,
    });
  }
}

function isProxyFailure(message: string, code: string | undefined, status: number | null): boolean {
  if (status === 407 || /proxy|tunnel|proxyconnect/i.test(message) || code === "ERR_PROXY_CONNECTION_FAILED") {
    return true;
  }
  // Axios only exposes an undifferentiated connection error for several proxy
  // failures. With an explicit proxy route, rotate that route instead of
  // treating the provider itself as unhealthy.
  return status === null && code !== undefined;
}
