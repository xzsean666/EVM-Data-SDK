import { createHash } from "node:crypto";

import { z } from "zod";

import type { ProviderName } from "../domain/chains";
import { invalidCursor } from "../domain/errors";
import type { CursorIdentity } from "../domain/pagination";
import {
  MAX_CURSOR_LENGTH as MAX_CURSOR_LENGTH_VALUE,
} from "../domain/pagination";
import type { NormalizedProviderRequest } from "../providers/DataProviderAdapter";
import type { OperationName as DomainOperationName } from "../domain/operations";

export const CURSOR_VERSION = 1 as const;
export const QUERY_FINGERPRINT_LENGTH = 43;

export interface CursorExpectation {
  readonly operation: DomainOperationName;
  readonly chainId: number;
  readonly queryFingerprint: string;
}

const providerPageStateSchema = z.unknown().superRefine((value, context) => {
  try {
    validatePageState(value, 0, new WeakSet<object>());
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Invalid provider page state.",
    });
  }
});

const cursorSchema = z
  .object({
    version: z.literal(CURSOR_VERSION),
    operation: z.enum(["getTransactions", "getNativeBalance", "getErc20Transfers"]),
    provider: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .refine((value) => !/^https?:\/\//i.test(value) && !/[/?#]/.test(value)),
    providerConfigurationId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    queryFingerprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    providerPageState: providerPageStateSchema,
  })
  .strict();

export function queryFingerprint(
  request: NormalizedProviderRequest,
  chainId: number,
): string {
  const semanticQuery = semanticQueryShape(request, chainId);
  return createHash("sha256")
    .update(JSON.stringify(semanticQuery), "utf8")
    .digest("base64url");
}

export function encodeCursor(identity: CursorIdentity): string {
  const normalized = parseCursorIdentity(identity);
  const json = JSON.stringify(normalized);
  const encoded = Buffer.from(json, "utf8").toString("base64url");
  if (encoded.length > MAX_CURSOR_LENGTH_VALUE) {
    throw invalidCursor("Cursor exceeds the maximum accepted size.");
  }
  return encoded;
}

export function decodeCursor(value: string): CursorIdentity {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CURSOR_LENGTH_VALUE) {
    throw invalidCursor("Cursor is empty or exceeds the maximum accepted size.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw invalidCursor("Cursor is not valid base64url.");
  }

  let json: string;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) {
      throw new Error("non-canonical base64url");
    }
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw invalidCursor("Cursor is not valid UTF-8 base64url JSON.", error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw invalidCursor("Cursor JSON is malformed.", error);
  }
  return parseCursorIdentity(parsed);
}

export function assertCursorMatches(
  identity: CursorIdentity,
  expectation: CursorExpectation,
): void {
  if (
    identity.operation !== expectation.operation ||
    identity.chainId !== expectation.chainId ||
    identity.queryFingerprint !== expectation.queryFingerprint
  ) {
    throw invalidCursor("Cursor does not match the requested operation or filters.");
  }
}

export function normalizeProviderConfigurationId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw invalidCursor("Provider configuration ID is invalid.");
  }
  return value;
}

function parseCursorIdentity(value: unknown): CursorIdentity {
  const parsed = cursorSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidCursor("Cursor schema is invalid.");
  }

  return freezeCursorIdentity({
    version: parsed.data.version,
    operation: parsed.data.operation,
    provider: parsed.data.provider as ProviderName,
    providerConfigurationId: parsed.data.providerConfigurationId,
    chainId: parsed.data.chainId,
    queryFingerprint: parsed.data.queryFingerprint,
    providerPageState: cloneAndFreezePageState(parsed.data.providerPageState),
  });
}

function semanticQueryShape(
  request: NormalizedProviderRequest,
  chainId: number,
): Record<string, string | number | null> {
  switch (request.operation) {
    case "getNativeBalance":
      return {
        operation: request.operation,
        chainId,
        address: request.address,
      };
    case "getTransactions":
      return {
        operation: request.operation,
        chainId,
        address: request.address,
        pageSize: request.pageSize,
        order: request.order,
        startBlock: request.startBlock,
        endBlock: request.endBlock,
      };
    case "getErc20Transfers":
      return {
        operation: request.operation,
        chainId,
        address: request.address,
        tokenAddress: request.tokenAddress,
        direction: request.direction,
        pageSize: request.pageSize,
        order: request.order,
        startBlock: request.startBlock,
        endBlock: request.endBlock,
      };
  }
}

function validatePageState(value: unknown, depth: number, seen: WeakSet<object>): void {
  if (depth > 8) {
    throw new Error("Provider page state is too deeply nested.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string") {
      validatePageStateString(value);
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error("Provider page state numbers must be safe integers.");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error("Provider page state must be JSON-compatible.");
  }
  if (seen.has(value)) {
    throw new Error("Provider page state must not be circular.");
  }
  seen.add(value);

  if (Array.isArray(value)) {
    if (value.length > 128) {
      throw new Error("Provider page state array is too large.");
    }
    for (const entry of value) {
      validatePageState(entry, depth + 1, seen);
    }
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Provider page state must contain plain objects only.");
  }
  const entries = Object.entries(value);
  if (entries.length > 64) {
    throw new Error("Provider page state object is too large.");
  }
  for (const [key, entry] of entries) {
    if (isForbiddenPageStateKey(key)) {
      throw new Error("Provider page state contains a forbidden field.");
    }
    validatePageStateString(key);
    validatePageState(entry, depth + 1, seen);
  }
  seen.delete(value);
}

function validatePageStateString(value: string): void {
  if (value.length > 2048) {
    throw new Error("Provider page state string is too large.");
  }
  if (/^https?:\/\//i.test(value)) {
    throw new Error("Provider page state must not contain raw URLs.");
  }
}

function isForbiddenPageStateKey(value: string): boolean {
  return /(?:^|[-_])(?:api[-_]?key|authorization|proxy[-_]?authorization|password|passwd|secret|credential|cookie|headers?|result|items?)(?:$|[-_])/i.test(value);
}

function cloneAndFreezePageState(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreezePageState(entry)));
  }
  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = cloneAndFreezePageState(entry);
  }
  return Object.freeze(clone);
}

function freezeCursorIdentity(identity: CursorIdentity): CursorIdentity {
  return Object.freeze(identity);
}
