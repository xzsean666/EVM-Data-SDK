import type { EvmDataError } from "../../domain/errors";
import { EvmDataError as EvmDataErrorClass } from "../../domain/errors";
import { isHttpTransportError } from "../../transport/HttpTransport";
import type { HttpResponse } from "../../transport/HttpTransport";

export function classifyMoralisHttpResponse(
  response: HttpResponse,
  chainId: number,
): EvmDataError | null {
  if (response.status >= 200 && response.status < 300) {
    return null;
  }

  const retryAfterMs = parseRetryAfter(findHeader(response.headers, "retry-after"));
  const text = responseText(response.body);
  if (response.status === 401) {
    return providerError("AUTHENTICATION_FAILED", "Moralis rejected the API key.", false, chainId);
  }
  if (response.status === 403) {
    return /(plan|quota|limit|forbidden|permission|subscription)/i.test(text)
      ? providerError("PLAN_RESTRICTED", "Moralis plan does not permit this request.", false, chainId)
      : providerError("AUTHENTICATION_FAILED", "Moralis rejected the API key.", false, chainId);
  }
  if (response.status === 404) {
    return /unsupported|invalid.*chain|chain/i.test(text)
      ? providerError("UNSUPPORTED_CHAIN", "Moralis does not support this chain.", false, chainId)
      : providerError("INVALID_PROVIDER_RESPONSE", "Moralis endpoint returned not found.", false, chainId);
  }
  if (response.status === 408) {
    return providerError("REQUEST_TIMEOUT", "Moralis request timed out.", true, chainId, retryAfterMs);
  }
  if (response.status === 425) {
    return providerError("PROVIDER_UNAVAILABLE", "Moralis is temporarily unavailable.", true, chainId, retryAfterMs);
  }
  if (response.status === 429) {
    return providerError("RATE_LIMITED", "Moralis rate limit was reached.", true, chainId, retryAfterMs);
  }
  if (response.status === 400 || response.status === 422) {
    return providerError("INVALID_REQUEST", "Moralis rejected the request parameters.", false, chainId);
  }
  if (response.status >= 500 && response.status <= 599) {
    return providerError("PROVIDER_UNAVAILABLE", "Moralis is temporarily unavailable.", true, chainId, retryAfterMs);
  }
  return providerError("INVALID_PROVIDER_RESPONSE", "Moralis returned an unexpected HTTP response.", false, chainId);
}

export function normalizeMoralisTransportError(error: unknown, chainId: number): EvmDataError | null {
  if (!isHttpTransportError(error)) {
    return null;
  }
  const message = error.code === "REQUEST_TIMEOUT"
    ? "Moralis request timed out."
    : error.code === "REQUEST_ABORTED"
      ? "Moralis request was aborted."
      : error.code === "PROXY_ERROR"
        ? "Moralis request failed at the proxy boundary."
        : "Moralis network request failed.";
  return new EvmDataErrorClass({
    code: error.code,
    message,
    retryable: error.retryable,
    provider: "moralis",
    chainId,
  });
}

function providerError(
  code: EvmDataError["code"],
  message: string,
  retryable: boolean,
  chainId: number,
  retryAfterMs: number | null = null,
): EvmDataError {
  return new EvmDataErrorClass({
    code,
    message,
    retryable,
    provider: "moralis",
    chainId,
    ...(retryAfterMs === null ? {} : { retryAfterMs }),
  });
}

function responseText(body: unknown): string {
  try {
    if (typeof body === "string") {
      return body;
    }
    if (body !== null && typeof body === "object") {
      const record = body as Record<string, unknown>;
      const message = record.message ?? record.error ?? record.code;
      if (typeof message === "string") {
        return message;
      }
    }
    return JSON.stringify(body ?? "");
  } catch {
    return "";
  }
}

function parseRetryAfter(value: string | readonly string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) {
    return null;
  }
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(86_400_000, Math.round(seconds * 1_000));
  }
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? Math.min(86_400_000, Math.max(0, timestamp - Date.now()))
    : null;
}

function findHeader(
  headers: Readonly<Record<string, string | readonly string[]>>,
  name: string,
): string | readonly string[] | undefined {
  const normalized = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === normalized)?.[1];
}
