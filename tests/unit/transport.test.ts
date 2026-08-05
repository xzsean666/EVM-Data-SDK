import { createServer, type Server } from "node:http";

import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it } from "vitest";

import {
  AxiosHttpTransport,
  normalizeAxiosError,
  parseHttpProxyUrl,
} from "../../src/transport/AxiosHttpTransport";
import { HttpTransportError } from "../../src/transport/HttpTransport";
import {
  REDACTED_VALUE,
  redactAxiosError,
  redactHeaders,
  redactUnknown,
  redactUrl,
} from "../../src/transport/redaction";

const apiKey = "api-key-secret";
const proxyPassword = "proxy-password-secret";
const cursor = "provider-page-key-secret";
const requestUrl = "https://provider.example/data";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("redaction", () => {
  it("redacts URL query secrets and proxy userinfo", () => {
    const value = redactUrl(
      `https://proxy-user:${proxyPassword}@provider.example/data?apikey=${apiKey}&pageKey=${cursor}&address=0x1234`,
      { knownSecrets: [apiKey, proxyPassword, cursor] },
    );

    expect(value).not.toContain(apiKey);
    expect(value).not.toContain(proxyPassword);
    expect(value).not.toContain(cursor);
    expect(value).toContain("address=0x1234");
  });

  it("redacts provider cursor query values", () => {
    const value = redactUrl(`${requestUrl}?cursor=${cursor}&address=0x1234`, { knownSecrets: [cursor] });
    expect(value).not.toContain(cursor);
    expect(value).toContain("cursor=%5BREDACTED%5D");
  });

  it("redacts sensitive headers, nested fields, cycles, and known secret echoes", () => {
    const nested: Record<string, unknown> = {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Trace": apiKey,
      },
      config: {
        url: `${requestUrl}?apikey=${apiKey}&pageKey=${cursor}`,
        params: { apiKey, pageKey: cursor, address: "0x1234" },
      },
      proxy: {
        auth: { username: "proxy-user", password: proxyPassword },
      },
      cause: { message: `upstream echoed ${apiKey}` },
    };
    nested.self = nested;

    const result = JSON.stringify(redactUnknown(nested, { knownSecrets: [apiKey, proxyPassword, cursor] }));
    expect(result).not.toContain(apiKey);
    expect(result).not.toContain(proxyPassword);
    expect(result).not.toContain(cursor);
    expect(result).toContain("[CIRCULAR]");
    expect(redactHeaders({ Authorization: `Bearer ${apiKey}`, "X-Auth-Token": "token-secret", "X-Request-Id": "safe" }, { knownSecrets: [apiKey] })).toMatchObject({
      Authorization: REDACTED_VALUE,
      "X-Auth-Token": REDACTED_VALUE,
      "X-Request-Id": "safe",
    });
  });

  it("redacts Axios errors without exposing their config or response echoes", () => {
    const config = {
      url: `${requestUrl}?apikey=${apiKey}`,
      headers: { Authorization: `Bearer ${apiKey}` },
      params: { pageKey: cursor },
    } as AxiosRequestConfig;
    const error = new AxiosError(
      `request failed at ${config.url} with ${apiKey}`,
      "ERR_NETWORK",
      config as never,
    );
    error.response = {
      status: 500,
      statusText: "error",
      headers: {},
      config: config as never,
      data: { echo: apiKey, pageKey: cursor },
    };

    const sanitized = JSON.stringify(redactAxiosError(error, { knownSecrets: [apiKey, cursor] }));
    expect(sanitized).not.toContain(apiKey);
    expect(sanitized).not.toContain(cursor);
  });
});

describe("AxiosHttpTransport", () => {
  it("returns successful and non-2xx response bodies without provider interpretation", async () => {
    let captured: AxiosRequestConfig | undefined;
    const client = axios.create({
      adapter: async (config) => {
        captured = config;
        return {
          data: { status: "0", result: "logical provider body" },
          status: 429,
          statusText: "Too Many Requests",
          headers: { "retry-after": "3" },
          config,
          request: {},
        };
      },
    });
    const transport = new AxiosHttpTransport({ axiosInstance: client });

    const response = await transport.request({
      method: "GET",
      url: requestUrl,
      headers: { Authorization: `Bearer ${apiKey}` },
      params: { pageKey: cursor },
      timeoutMs: 1_000,
    });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ status: "0", result: "logical provider body" });
    expect(response.headers["retry-after"]).toBe("3");
    expect(captured?.proxy).toBe(false);
    expect(captured?.maxRedirects).toBe(0);
    expect(captured?.validateStatus?.(429)).toBe(true);
  });

  it("propagates a pre-aborted signal without calling Axios", async () => {
    let called = false;
    const client = axios.create({
      adapter: async () => {
        called = true;
        throw new Error("adapter should not run");
      },
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      new AxiosHttpTransport({ axiosInstance: client }).request({
        method: "GET",
        url: requestUrl,
        timeoutMs: 1_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "REQUEST_ABORTED", retryable: false });
    expect(called).toBe(false);
  });

  it("passes an active AbortSignal through to Axios and normalizes cancellation", async () => {
    const controller = new AbortController();
    const client = axios.create({
      adapter: async (config) =>
        new Promise((_, reject) => {
          const signal = config.signal;
          if (!signal) {
            reject(new Error("missing abort signal"));
            return;
          }
          if (typeof signal.addEventListener !== "function") {
            reject(new Error("signal does not support abort listeners"));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(new AxiosError("canceled", "ERR_CANCELED", config as never));
          });
        }),
    });
    const pending = new AxiosHttpTransport({ axiosInstance: client }).request({
      method: "GET",
      url: requestUrl,
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED", retryable: false });
  });

  it("normalizes timeout, network, and proxy failures as retryable transport errors", async () => {
    const cases = [
      { code: "ECONNABORTED", message: "timeout of 1000ms exceeded", expected: "REQUEST_TIMEOUT" },
      { code: "ECONNRESET", message: "socket reset", expected: "NETWORK_ERROR" },
      { code: "ERR_NETWORK", message: "Proxy CONNECT failed", expected: "PROXY_ERROR", proxy: parseHttpProxyUrl("http://proxy-user:proxy-pass@127.0.0.1:7890") },
      { code: "ERR_NETWORK", message: "Network Error", expected: "PROXY_ERROR", proxy: parseHttpProxyUrl("http://proxy-user:proxy-pass@127.0.0.1:7890") },
    ] as const;

    for (const testCase of cases) {
      const client = axios.create({
        adapter: async (config) => {
          throw new AxiosError(testCase.message, testCase.code, config as never);
        },
      });
      const request = {
        method: "GET" as const,
        url: requestUrl,
        timeoutMs: 1_000,
        ...(!("proxy" in testCase) ? {} : { proxy: testCase.proxy }),
      };
      const error = await new AxiosHttpTransport({ axiosInstance: client })
        .request(request)
        .catch((value: unknown) => value);

      expect(error).toMatchObject({ code: testCase.expected, retryable: true });
      expect(error).toBeInstanceOf(HttpTransportError);
    }
  });

  it("classifies a proxied HTTP 407 response as a proxy-boundary failure", async () => {
    const client = axios.create({
      adapter: async (config) => ({
        data: { message: "proxy authentication required" },
        status: 407,
        statusText: "Proxy Authentication Required",
        headers: {},
        config,
        request: {},
      }),
    });

    await expect(
      new AxiosHttpTransport({ axiosInstance: client }).request({
        method: "GET",
        url: requestUrl,
        timeoutMs: 1_000,
        proxy: parseHttpProxyUrl("http://proxy-user:proxy-pass@127.0.0.1:7890"),
      }),
    ).rejects.toMatchObject({ code: "PROXY_ERROR", retryable: true, status: 407 });
  });

  it("uses the explicit proxy object and never discovers an environment proxy", async () => {
    const previous = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = "http://environment-proxy.invalid:8080";
    try {
      let captured: AxiosRequestConfig | undefined;
      const client = axios.create({
        adapter: async (config) => {
          captured = config;
          return {
            data: "ok",
            status: 200,
            statusText: "OK",
            headers: {},
            config,
            request: {},
          };
        },
      });
      const proxy = parseHttpProxyUrl("https://proxy-user:proxy-pass@127.0.0.1:8443");
      await new AxiosHttpTransport({ axiosInstance: client }).request({
        method: "GET",
        url: requestUrl,
        timeoutMs: 1_000,
        proxy,
      });

      expect(captured?.proxy).toMatchObject({ protocol: "https", host: "127.0.0.1", port: 8443, auth: { username: "proxy-user", password: "proxy-pass" } });
    } finally {
      if (previous === undefined) {
        delete process.env.HTTP_PROXY;
      } else {
        process.env.HTTP_PROXY = previous;
      }
    }
  });

  it("does not follow redirects when the upstream returns a redirect response", async () => {
    let targetHits = 0;
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/target" });
        response.end();
        return;
      }
      targetHits += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ followed: true }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test server did not expose a port.");
    }

    const response = await new AxiosHttpTransport().request({
      method: "GET",
      url: `http://127.0.0.1:${address.port}/redirect`,
      timeoutMs: 2_000,
    });
    expect(response.status).toBe(302);
    expect(targetHits).toBe(0);
  });
});

describe("proxy URL parsing", () => {
  it("accepts HTTP(S), decodes userinfo, and rejects SOCKS", () => {
    expect(parseHttpProxyUrl("https://proxy%40user:pass%3Aword@proxy.example:8443")).toEqual({
      protocol: "https",
      host: "proxy.example",
      port: 8443,
      auth: { username: "proxy@user", password: "pass:word" },
    });
    expect(() => parseHttpProxyUrl("socks5://127.0.0.1:1080")).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });
});

describe("normalizeAxiosError", () => {
  it("does not include request secrets in the normalized failure", () => {
    const config = { url: `${requestUrl}?apikey=${apiKey}` } as AxiosRequestConfig;
    const error = normalizeAxiosError(
      new AxiosError(`failed ${apiKey}`, "ERR_NETWORK", config as never),
      { method: "GET", url: requestUrl, params: { apikey: apiKey }, timeoutMs: 1_000 },
      [apiKey],
    );
    expect(JSON.stringify(error)).not.toContain(apiKey);
    expect(error.message).not.toContain(apiKey);
  });
});
