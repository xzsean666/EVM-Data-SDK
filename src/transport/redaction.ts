export const REDACTED_VALUE = "[REDACTED]";

const sensitiveNamePattern = /(?:^|[-_])(?:apikey|api[-_]?key|authorization|proxy[-_]?authorization|x[-_]?api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|credential|cookie|set[-_]?cookie|pagekey|cursor|auth|username)(?:$|[-_])/i;
const sensitiveUrlQueryPattern = /([?&](?:apikey|api[-_]?key|authorization|proxy[-_]?authorization|x[-_]?api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|credential|pagekey|cursor)=)[^&#\s]*/gi;

export interface RedactionOptions {
  readonly knownSecrets?: readonly string[];
  readonly maxDepth?: number;
}

export function redactUrl(value: string, options: RedactionOptions = {}): string {
  const withKnownSecrets = replaceKnownSecrets(value, options.knownSecrets);

  try {
    const url = new URL(withKnownSecrets);
    if (url.username !== "") {
      url.username = REDACTED_VALUE;
    }
    if (url.password !== "") {
      url.password = REDACTED_VALUE;
    }

    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveName(key)) {
        url.searchParams.set(key, REDACTED_VALUE);
      }
    }
    return url.toString();
  } catch {
    return withKnownSecrets.replace(sensitiveUrlQueryPattern, `$1${REDACTED_VALUE}`);
  }
}

export function redactHeaders(
  headers: unknown,
  options: RedactionOptions = {},
): Record<string, unknown> {
  if (headers === null || typeof headers !== "object") {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = isSensitiveName(key)
      ? REDACTED_VALUE
      : redactUnknown(value, options);
  }
  return result;
}

export function redactUnknown(value: unknown, options: RedactionOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 6;
  return redactValue(value, options, maxDepth, new WeakSet<object>());
}

export function redactAxiosError(error: unknown, options: RedactionOptions = {}): Record<string, unknown> {
  const redacted = redactUnknown(error, options);
  if (redacted !== null && typeof redacted === "object" && !Array.isArray(redacted)) {
    return redacted as Record<string, unknown>;
  }
  return { value: redacted };
}

export function redactMessage(value: string, options: RedactionOptions = {}): string {
  const withKnownSecrets = replaceKnownSecrets(value, options.knownSecrets);
  return withKnownSecrets
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED_VALUE}`)
    .replace(sensitiveUrlQueryPattern, `$1${REDACTED_VALUE}`);
}

function redactValue(
  value: unknown,
  options: RedactionOptions,
  remainingDepth: number,
  seen: WeakSet<object>,
): unknown {
  if (remainingDepth <= 0) {
    return "[TRUNCATED]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactMessage(value, options);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }

  if (value instanceof URL) {
    return redactUrl(value.toString(), options);
  }
  if (value instanceof Error) {
    const error = value as Error & { code?: unknown; status?: unknown; response?: unknown; cause?: unknown };
    const result: Record<string, unknown> = {
      name: error.name,
      message: redactMessage(error.message, options),
    };
    if (error.code !== undefined) {
      result.code = redactValue(error.code, options, remainingDepth - 1, seen);
    }
    if (error.status !== undefined) {
      result.status = redactValue(error.status, options, remainingDepth - 1, seen);
    }
    if (error.response !== undefined) {
      result.response = redactValue(error.response, options, remainingDepth - 1, seen);
    }
    if (error.cause !== undefined) {
      result.cause = redactValue(error.cause, options, remainingDepth - 1, seen);
    }
    return result;
  }
  if (typeof value !== "object") {
    return REDACTED_VALUE;
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, options, remainingDepth - 1, seen));
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    let entry: unknown;
    try {
      entry = (value as Record<string, unknown>)[key];
    } catch {
      result[key] = REDACTED_VALUE;
      continue;
    }

    if (isSensitiveName(key)) {
      result[key] = REDACTED_VALUE;
    } else if (key.toLowerCase() === "url") {
      result[key] = typeof entry === "string" ? redactUrl(entry, options) : REDACTED_VALUE;
    } else if (key.toLowerCase() === "headers") {
      result[key] = redactHeaders(entry, options);
    } else {
      result[key] = redactValue(entry, options, remainingDepth - 1, seen);
    }
  }
  return result;
}

function replaceKnownSecrets(value: string, knownSecrets: readonly string[] | undefined): string {
  if (knownSecrets === undefined || knownSecrets.length === 0) {
    return value;
  }

  return [...new Set(knownSecrets)]
    .filter((secret) => secret.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce((result, secret) => result.split(secret).join(REDACTED_VALUE), value);
}

function isSensitiveName(value: string): boolean {
  return sensitiveNamePattern.test(value);
}
