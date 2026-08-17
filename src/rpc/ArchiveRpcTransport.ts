import { z } from "zod";

import { archiveRpcUnavailable, rpcResponseInvalid } from "../domain/errors";
import type { EvmDataError } from "../domain/errors";
import { AxiosHttpTransport } from "../transport/AxiosHttpTransport";
import { isHttpTransportError, type HttpTransport } from "../transport/HttpTransport";

/**
 * Direct-only JSON-RPC 2.0 HTTP mechanics and envelope validation for the
 * Ethereum Archive RPC and JSON-RPC Batch features (ADR-028/ADR-029).
 *
 * This module owns exactly one thing: sending JSON-RPC single/batch requests and
 * validating the shape of the responses. It never accepts a proxy, never
 * reads `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`, and never routes
 * through `ProxyPool` or `SingBoxProxyManager` — there is no proxy parameter
 * on call options at all, so that boundary is enforced by the
 * type signature, not just by convention. Endpoint health, retry, endpoint
 * selection, and ABI knowledge belong to pool and executor layers, not here.
 */

export interface ArchiveRpcTransportOptions {
  readonly httpTransport?: HttpTransport;
}

export interface ArchiveRpcCallOptions {
  /** Direct HTTPS JSON-RPC endpoint URL. Never logged or included in errors. */
  readonly endpointUrl: string;
  readonly method: string;
  readonly params: readonly unknown[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ArchiveRpcBatchCallOptions {
  /** Direct HTTPS JSON-RPC endpoint URL. Never logged or included in errors. */
  readonly endpointUrl: string;
  readonly requests: readonly {
    readonly id: string | number;
    readonly method: string;
    readonly params?: readonly unknown[];
  }[];
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface JsonRpcBatchResponseItem {
  readonly id: string | number;
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

/**
 * A well-formed JSON-RPC 2.0 error envelope from the node itself (not a
 * transport/network failure). Callers with method-specific context (for
 * example distinguishing "block not found" from "state unavailable" for
 * `eth_call`) decide how to map `rpcCode`/`rpcMessage` onto a stable SDK
 * error code. The message is treated as provider-controlled text, mirroring
 * the existing `classifyAlchemyJsonRpcError` convention; it must not and
 * does not contain the endpoint URL.
 */
export class JsonRpcCallError extends Error {
  readonly rpcCode: number;
  readonly rpcMessage: string;

  constructor(rpcCode: number, rpcMessage: string) {
    super(`Archive RPC returned JSON-RPC error ${rpcCode}: ${rpcMessage}`);
    this.name = "JsonRpcCallError";
    this.rpcCode = rpcCode;
    this.rpcMessage = rpcMessage;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isJsonRpcCallError(value: unknown): value is JsonRpcCallError {
  return value instanceof JsonRpcCallError;
}

const jsonRpcEnvelopeSchema = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    id: z.union([z.string(), z.number()]).nullable().optional(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().int(),
        message: z.string(),
        data: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export class ArchiveRpcTransport {
  private readonly httpTransport: HttpTransport;

  constructor(options: ArchiveRpcTransportOptions = {}) {
    this.httpTransport = options.httpTransport ?? new AxiosHttpTransport();
  }

  /**
   * Sends one JSON-RPC 2.0 request and returns its `result`. Throws
   * `JsonRpcCallError` for a well-formed node-level error envelope, or an
   * `EvmDataError` (`ARCHIVE_RPC_UNAVAILABLE`, `RPC_RESPONSE_INVALID`, or a
   * reused transport code) for every other failure.
   */
  async call(options: ArchiveRpcCallOptions): Promise<unknown> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(options.endpointUrl);
    } catch {
      throw archiveRpcUnavailable("Archive RPC endpoint URL is invalid.");
    }
    if (parsedUrl.protocol !== "https:") {
      throw archiveRpcUnavailable("Archive RPC endpoints must use HTTPS.");
    }

    let response;
    try {
      response = await this.httpTransport.request({
        method: "POST",
        url: options.endpointUrl,
        headers: { "content-type": "application/json" },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: options.method,
          params: options.params,
        },
        timeoutMs: options.timeoutMs,
        // This is the direct-only boundary: `proxy` is always explicitly
        // `null`, never derived from configuration, environment, or a
        // caller-supplied value. There is no other code path that can set
        // it for an Archive RPC request.
        proxy: null,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error: unknown) {
      throw mapTransportError(error);
    }

    if (response.status < 200 || response.status >= 300) {
      throw archiveRpcUnavailable(
        `Archive RPC endpoint returned an unexpected HTTP status ${response.status}.`,
      );
    }

    const parsed = jsonRpcEnvelopeSchema.safeParse(response.body);
    if (!parsed.success) {
      throw rpcResponseInvalid("Archive RPC endpoint returned a malformed JSON-RPC response.");
    }

    if (parsed.data.error !== undefined) {
      throw new JsonRpcCallError(parsed.data.error.code, parsed.data.error.message);
    }
    if (parsed.data.result === undefined) {
      throw rpcResponseInvalid("Archive RPC endpoint returned neither a result nor an error.");
    }

    return parsed.data.result;
  }

  /**
   * Sends a JSON-RPC 2.0 batch payload `[ {...}, {...} ]` and returns array of
   * results aligned by request identifier.
   */
  async batchCall(options: ArchiveRpcBatchCallOptions): Promise<readonly JsonRpcBatchResponseItem[]> {
    if (options.requests.length === 0) {
      return Object.freeze([]);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(options.endpointUrl);
    } catch {
      throw archiveRpcUnavailable("Archive RPC endpoint URL is invalid.");
    }
    if (parsedUrl.protocol !== "https:") {
      throw archiveRpcUnavailable("Archive RPC endpoints must use HTTPS.");
    }

    const body = options.requests.map((req) => ({
      jsonrpc: "2.0",
      id: req.id,
      method: req.method,
      params: req.params ?? [],
    }));

    let response;
    try {
      response = await this.httpTransport.request({
        method: "POST",
        url: options.endpointUrl,
        headers: { "content-type": "application/json" },
        body,
        timeoutMs: options.timeoutMs,
        proxy: null,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error: unknown) {
      throw mapTransportError(error);
    }

    if (response.status < 200 || response.status >= 300) {
      throw archiveRpcUnavailable(
        `Archive RPC endpoint returned an unexpected HTTP status ${response.status}.`,
      );
    }

    // If the node rejects the entire batch request with a single error envelope
    if (typeof response.body === "object" && response.body !== null && !Array.isArray(response.body)) {
      const singleEnvelope = jsonRpcEnvelopeSchema.safeParse(response.body);
      if (singleEnvelope.success && singleEnvelope.data.error !== undefined) {
        throw new JsonRpcCallError(singleEnvelope.data.error.code, singleEnvelope.data.error.message);
      }
      throw rpcResponseInvalid("Archive RPC endpoint returned an unexpected non-array batch response.");
    }

    const parsed = z.array(jsonRpcEnvelopeSchema).safeParse(response.body);
    if (!parsed.success) {
      throw rpcResponseInvalid("Archive RPC endpoint returned a malformed JSON-RPC batch response.");
    }

    const responseById = new Map<string | number, z.infer<typeof jsonRpcEnvelopeSchema>>();
    for (const item of parsed.data) {
      if (item.id !== undefined && item.id !== null) {
        responseById.set(item.id, item);
      }
    }

    const results: JsonRpcBatchResponseItem[] = options.requests.map((req) => {
      const item = responseById.get(req.id);
      if (item === undefined) {
        return Object.freeze({
          id: req.id,
          success: false,
          error: Object.freeze({
            code: -32603,
            message: "Archive RPC endpoint omitted response for batch request id.",
          }),
        });
      }

      if (item.error !== undefined) {
        return Object.freeze({
          id: req.id,
          success: false,
          error: Object.freeze({
            code: item.error.code,
            message: item.error.message,
            ...(item.error.data !== undefined ? { data: item.error.data } : {}),
          }),
        });
      }

      if (item.result === undefined) {
        return Object.freeze({
          id: req.id,
          success: false,
          error: Object.freeze({
            code: -32603,
            message: "Archive RPC endpoint returned neither a result nor an error for batch item.",
          }),
        });
      }

      return Object.freeze({
        id: req.id,
        success: true,
        result: item.result,
      });
    });

    return Object.freeze(results);
  }
}

function mapTransportError(error: unknown): EvmDataError {
  if (!isHttpTransportError(error)) {
    return archiveRpcUnavailable("Archive RPC request failed at the network boundary.", error);
  }
  const message = error.code === "REQUEST_TIMEOUT"
    ? "Archive RPC request timed out."
    : error.code === "REQUEST_ABORTED"
      ? "Archive RPC request was aborted."
      : "Archive RPC network request failed.";
  // `PROXY_ERROR` cannot occur here because `proxy` is always `null` above,
  // but every other transport code reuses this same stable semantics.
  return archiveRpcUnavailable(message, error);
}
