import { EvmDataError } from "../../domain/errors";
import { isHttpTransportError } from "../../transport/HttpTransport";
import type { HttpResponse } from "../../transport/HttpTransport";

export function classifyAlchemyHttpResponse(response: HttpResponse, chainId: number): EvmDataError | null {
  if (response.status >= 200 && response.status < 300) {
    return null;
  }
  const retryAfterMs = parseRetryAfter(response.headers["retry-after"] ?? response.headers["Retry-After"]);
  if (response.status === 401 || response.status === 403) {
    return alchemyError("AUTHENTICATION_FAILED", "Alchemy rejected the API key.", false, chainId, retryAfterMs);
  }
  if (response.status === 402) {
    return alchemyError("PLAN_RESTRICTED", "Alchemy plan does not permit this request.", false, chainId, retryAfterMs);
  }
  if (response.status === 408) {
    return alchemyError("REQUEST_TIMEOUT", "Alchemy request timed out.", true, chainId, retryAfterMs);
  }
  if (response.status === 429) {
    return alchemyError("RATE_LIMITED", "Alchemy rate limit was reached.", true, chainId, retryAfterMs);
  }
  if (response.status === 400 || response.status === 422) {
    return alchemyError("INVALID_REQUEST", "Alchemy rejected the request parameters.", false, chainId, retryAfterMs);
  }
  if (response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504) {
    return alchemyError("PROVIDER_UNAVAILABLE", "Alchemy is temporarily unavailable.", true, chainId, retryAfterMs);
  }
  return alchemyError("INVALID_PROVIDER_RESPONSE", "Alchemy returned an unexpected HTTP response.", false, chainId, retryAfterMs);
}

export function classifyAlchemyJsonRpcError(code: number, message: string, chainId: number): EvmDataError {
  const text = message.toLowerCase();
  if (code === -32001 || /unauthori|invalid api key|api key/.test(text)) {
    return alchemyError("AUTHENTICATION_FAILED", "Alchemy rejected the API key.", false, chainId);
  }
  if (code === -32002 || /rate limit|too many requests|quota|compute unit/.test(text)) {
    return alchemyError("RATE_LIMITED", "Alchemy rate limit was reached.", true, chainId);
  }
  if (code === -32602 || /invalid param|invalid argument|unsupported chain|method not found/.test(text)) {
    return alchemyError("INVALID_REQUEST", "Alchemy rejected the request parameters.", false, chainId);
  }
  if (code === -32601) {
    return alchemyError("UNSUPPORTED_OPERATION", "Alchemy does not support this operation.", false, chainId);
  }
  return alchemyError("PROVIDER_UNAVAILABLE", "Alchemy rejected the JSON-RPC request.", false, chainId);
}

export function normalizeAlchemyTransportError(error: unknown, chainId: number): EvmDataError | null {
  if (!isHttpTransportError(error)) {
    return null;
  }
  const message = error.code === "REQUEST_TIMEOUT"
    ? "Alchemy request timed out."
    : error.code === "REQUEST_ABORTED"
      ? "Alchemy request was aborted."
      : error.code === "PROXY_ERROR"
        ? "Alchemy request failed at the proxy boundary."
        : "Alchemy network request failed.";
  return new EvmDataError({ code: error.code, message, retryable: error.retryable, provider: "alchemy", chainId });
}

function alchemyError(
  code: EvmDataError["code"],
  message: string,
  retryable: boolean,
  chainId: number,
  retryAfterMs: number | null = null,
): EvmDataError {
  return new EvmDataError({
    code,
    message,
    retryable,
    provider: "alchemy",
    chainId,
    ...(retryAfterMs === null ? {} : { retryAfterMs }),
  });
}

function parseRetryAfter(value: string | readonly string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return null;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(86_400_000, Math.round(seconds * 1_000));
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.min(86_400_000, Math.max(0, timestamp - Date.now())) : null;
}
