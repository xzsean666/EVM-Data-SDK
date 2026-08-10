import type { EvmDataError } from "../../domain/errors";
import type { ProviderName } from "../../domain/chains";
import { EvmDataError as EvmDataErrorClass } from "../../domain/errors";
import { isHttpTransportError } from "../../transport/HttpTransport";
import type { HttpResponse } from "../../transport/HttpTransport";

const PLAN_RESTRICTION_PATTERN = /(?:free|plan|upgrade|subscription|not available).*?(?:chain|tier|plan)|chain.*?(?:free|plan|tier)|plan.*?(?:restrict|not permit)|(?:endpoint|api|action).*?(?:requires?|(?:only )?available|limited to).*?(?:plan|tier|standard|pro|paid)|(?:requires?|(?:only )?available|limited to).*?(?:standard|pro|paid).*(?:plan|tier)?/;

export interface EtherscanErrorContext {
  readonly chainId: number;
  readonly response?: HttpResponse;
}

export function classifyEtherscanHttpResponse(
  response: HttpResponse,
  chainId: number,
  provider: ProviderName = "etherscan",
): EvmDataError | null {
  if (response.status >= 200 && response.status < 300) {
    return null;
  }

  const retryAfterMs = parseRetryAfter(findHeader(response.headers, "retry-after"));
  if (response.status === 401 || response.status === 403) {
    return new EvmDataErrorClass({
      code: looksLikePlanRestriction(response.body) ? "PLAN_RESTRICTED" : "AUTHENTICATION_FAILED",
      message: looksLikePlanRestriction(response.body)
        ? "Indexed provider plan does not permit this request."
        : "Indexed provider rejected the API key.",
      retryable: false,
      provider,
      chainId,
      ...(retryAfterMs === null ? {} : { retryAfterMs }),
    });
  }
  if (response.status === 402) {
    return providerError("PLAN_RESTRICTED", "Indexed provider plan does not permit this request.", false, chainId, retryAfterMs, provider);
  }
  if (response.status === 400 || response.status === 422) {
    return providerError("INVALID_REQUEST", "Indexed provider rejected the request parameters.", false, chainId, retryAfterMs, provider);
  }
  if (response.status === 404 && /unsupported|invalid.*chain|chainid/i.test(bodyText(response.body))) {
    return providerError("UNSUPPORTED_CHAIN", "Indexed provider does not support this chain.", false, chainId, retryAfterMs, provider);
  }
  if (response.status === 408) {
    return providerError("REQUEST_TIMEOUT", "Indexed provider request timed out.", true, chainId, retryAfterMs, provider);
  }
  if (response.status === 429) {
    return providerError("RATE_LIMITED", "Indexed provider rate limit was reached.", true, chainId, retryAfterMs, provider);
  }
  if (response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504) {
    return providerError("PROVIDER_UNAVAILABLE", "Indexed provider is temporarily unavailable.", true, chainId, retryAfterMs, provider);
  }
  return providerError("INVALID_PROVIDER_RESPONSE", "Indexed provider returned an unexpected HTTP response.", false, chainId, retryAfterMs, provider);
}

export function classifyEtherscanEnvelopeError(
  message: string,
  result: unknown,
  chainId: number,
  provider: ProviderName = "etherscan",
): EvmDataError {
  const text = `${message} ${typeof result === "string" ? result : ""}`.toLowerCase();
  if (/(invalid|missing|not found).*api key|api key.*(invalid|missing)|invalid api key|unauthorized/.test(text)) {
    return providerError("AUTHENTICATION_FAILED", "Indexed provider rejected the API key.", false, chainId, null, provider);
  }
  if (PLAN_RESTRICTION_PATTERN.test(text)) {
    return providerError("PLAN_RESTRICTED", "Indexed provider plan does not permit this request.", false, chainId, null, provider);
  }
  if (/(unsupported|invalid).*chain|chainid|chain id/.test(text)) {
    return providerError("UNSUPPORTED_CHAIN", "Indexed provider does not support this chain.", false, chainId, null, provider);
  }
  if (/(invalid|missing).*(address|parameter|page|offset|tag)|invalid request/.test(text)) {
    return providerError("INVALID_REQUEST", "Indexed provider rejected the request parameters.", false, chainId, null, provider);
  }
  if (/(rate limit|too many requests|max rate|quota|daily limit|limit reached)/.test(text)) {
    return providerError("RATE_LIMITED", "Indexed provider rate limit was reached.", true, chainId, null, provider);
  }
  if (/(timeout|timed out|busy|temporarily unavailable|try again later)/.test(text)) {
    return providerError("PROVIDER_UNAVAILABLE", "Indexed provider is temporarily unavailable.", true, chainId, null, provider);
  }
  return providerError("PROVIDER_UNAVAILABLE", "Indexed provider rejected the request.", false, chainId, null, provider);
}

/**
 * Etherscan documents these endpoints as Standard-plan-and-above. A logical
 * rejection that is not a credential, parameter, rate, or transient error is
 * therefore a plan restriction rather than a generic provider outage.
 */
export function classifyEtherscanStandardEndpointError(
  message: string,
  result: unknown,
  chainId: number,
  provider: ProviderName = "etherscan",
): EvmDataError {
  const classified = classifyEtherscanEnvelopeError(message, result, chainId, provider);
  if (classified.code !== "PROVIDER_UNAVAILABLE" || classified.retryable) {
    return classified;
  }
  return providerError("PLAN_RESTRICTED", "Indexed provider plan does not permit this request.", false, chainId, null, provider);
}

export function normalizeEtherscanTransportError(
  error: unknown,
  chainId: number,
  provider: ProviderName = "etherscan",
): EvmDataError | null {
  if (!isHttpTransportError(error)) {
    return null;
  }
  const message = error.code === "REQUEST_TIMEOUT"
    ? "Indexed provider request timed out."
    : error.code === "REQUEST_ABORTED"
      ? "Indexed provider request was aborted."
      : error.code === "PROXY_ERROR"
        ? "Indexed provider request failed at the proxy boundary."
        : "Indexed provider network request failed.";
  return new EvmDataErrorClass({
    code: error.code,
    message,
    retryable: error.retryable,
    provider,
    chainId,
  });
}

function providerError(
  code: EvmDataError["code"],
  message: string,
  retryable: boolean,
  chainId: number,
  retryAfterMs: number | null = null,
  provider: ProviderName = "etherscan",
): EvmDataError {
  return new EvmDataErrorClass({
    code,
    message,
    retryable,
    provider,
    chainId,
    ...(retryAfterMs === null ? {} : { retryAfterMs }),
  });
}

function looksLikePlanRestriction(body: unknown): boolean {
  return PLAN_RESTRICTION_PATTERN.test(bodyText(body));
}

function bodyText(body: unknown): string {
  try {
    return (typeof body === "string" ? body : JSON.stringify(body ?? "")).toLowerCase();
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
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.min(86_400_000, Math.max(0, timestamp - Date.now()));
}

function findHeader(
  headers: Readonly<Record<string, string | readonly string[]>>,
  name: string,
): string | readonly string[] | undefined {
  const normalized = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === normalized);
  return entry?.[1];
}
