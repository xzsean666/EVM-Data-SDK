import type { ChainDefinition } from "../domain/chains";
import { invalidConfiguration, invalidCursor, unsupportedOperation } from "../domain/errors";
import type { NormalizedProviderRequest, CapabilityRequest, DataProviderAdapter } from "../providers/DataProviderAdapter";
import { validateProviderName } from "../providers/DataProviderAdapter";
import type { CursorIdentity } from "../domain/pagination";
import {
  assertCursorMatches,
  normalizeProviderConfigurationId,
  queryFingerprint,
} from "./cursorCodec";
import type { ChainRegistry } from "../chains/ChainRegistry";

export interface ProviderRouterEntry {
  readonly configurationId: string;
  readonly adapter: DataProviderAdapter;
}

export interface ProviderCandidate {
  readonly configurationId: string;
  readonly adapter: DataProviderAdapter;
  readonly chain: ChainDefinition;
}

export class ProviderRouter {
  private readonly registry: ChainRegistry;
  private readonly entries: readonly ProviderRouterEntry[];

  constructor(registry: ChainRegistry, entries: readonly ProviderRouterEntry[]) {
    const normalizedEntries = entries.map((entry) => {
      const configurationId = normalizeProviderConfigurationId(entry.configurationId);
      const providerName = validateProviderName(entry.adapter.name);
      if (providerName !== entry.adapter.name) {
        throw invalidConfiguration("Provider adapter names must be trimmed.");
      }
      if (typeof entry.adapter.supports !== "function") {
        throw invalidConfiguration("Provider adapter must declare supports().");
      }
      return Object.freeze({ configurationId, adapter: entry.adapter });
    });
    const ids = new Set<string>();
    for (const entry of normalizedEntries) {
      if (ids.has(entry.configurationId)) {
        throw invalidConfiguration(`Duplicate provider configuration ID ${entry.configurationId}.`);
      }
      ids.add(entry.configurationId);
    }
    this.registry = registry;
    this.entries = Object.freeze(normalizedEntries);
  }

  route(request: NormalizedProviderRequest): readonly ProviderCandidate[] {
    const chain = this.registry.resolve(request.chain);
    const candidates = this.entries
      .filter((entry) => supportsRequest(entry.adapter, request, chain, false))
      .map((entry) => toCandidate(entry, chain));

    if (candidates.length === 0) {
      throw unsupportedOperation(
        `No configured provider supports ${request.operation} on chain ${chain.chainId}.`,
        chain.chainId,
      );
    }
    return Object.freeze(candidates);
  }

  routeContinuation(
    request: NormalizedProviderRequest,
    identity: CursorIdentity,
  ): ProviderCandidate {
    const chain = this.registry.resolve(request.chain);
    assertCursorMatches(identity, {
      operation: request.operation,
      chainId: chain.chainId,
      queryFingerprint: queryFingerprint(request, chain.chainId),
    });

    const entry = this.entries.find(
      (candidate) =>
        candidate.configurationId === identity.providerConfigurationId &&
        candidate.adapter.name === identity.provider,
    );
    if (entry === undefined) {
      throw invalidCursor("The cursor provider configuration is no longer available.");
    }
    if (!supportsRequest(entry.adapter, request, chain, true)) {
      throw invalidCursor("The cursor provider no longer supports this request.");
    }
    return toCandidate(entry, chain);
  }
}

function supportsRequest(
  adapter: DataProviderAdapter,
  request: NormalizedProviderRequest,
  chain: ChainDefinition,
  continuation: boolean,
): boolean {
  if (!hasOperationMethod(adapter, request.operation)) {
    return false;
  }
  const capability: CapabilityRequest = {
    operation: request.operation,
    chain,
    request,
    continuation,
  };
  return adapter.supports(capability);
}

function hasOperationMethod(adapter: DataProviderAdapter, operation: NormalizedProviderRequest["operation"]): boolean {
  switch (operation) {
    case "getTransactions":
      return typeof adapter.getTransactions === "function";
    case "getNativeBalance":
      return typeof adapter.getNativeBalance === "function";
    case "getErc20Transfers":
      return typeof adapter.getErc20Transfers === "function";
  }
}

function toCandidate(entry: ProviderRouterEntry, chain: ChainDefinition): ProviderCandidate {
  return Object.freeze({
    configurationId: entry.configurationId,
    adapter: entry.adapter,
    chain,
  });
}
