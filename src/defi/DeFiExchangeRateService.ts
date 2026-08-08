import { defiExchangeRateDataUnavailable, invalidRequest } from "../domain/errors";
import type { DeFiExchangeRate, DeFiExchangeRateFailure, DeFiExchangeRateSnapshot, DeFiExchangeRateSnapshotRequest } from "../domain/defiExchangeRateModels";
import { parseDeFiExchangeRateSnapshotRequest } from "../domain/defiExchangeRateModels";
import type { MulticallAtBlockCallResult, MulticallAtBlockRequest, MulticallAtBlockResult } from "../domain/rpcModels";
import { MULTICALL3_GET_BLOCK_NUMBER_SELECTOR } from "../rpc/EthereumMulticall3Codec";
import { adapterCalls, CallRevertedError, evaluateAdapter, NotDeployedAtBlockError } from "./DeFiProtocolAdapter";
import type { DeFiTokenDefinition } from "./DeFiTokenDefinition";
import { DEFI_TOKEN_REGISTRY, registryVersion } from "./defiTokenRegistry";

export interface DeFiMulticallService { multicallAtBlock(request: MulticallAtBlockRequest): Promise<MulticallAtBlockResult>; }
export interface DeFiExchangeRateServiceOptions { readonly rpcServices: ReadonlyMap<1 | 8453, DeFiMulticallService>; readonly manifest?: readonly DeFiTokenDefinition[]; }

export class DeFiExchangeRateService {
  private readonly rpcServices: ReadonlyMap<1 | 8453, DeFiMulticallService>;
  private readonly manifest: readonly DeFiTokenDefinition[];
  private readonly version: string;

  constructor(options: DeFiExchangeRateServiceOptions) {
    this.rpcServices = options.rpcServices;
    this.manifest = options.manifest ?? DEFI_TOKEN_REGISTRY;
    this.version = registryVersion(this.manifest);
  }

  async getExchangeRatesAtBlock(request: DeFiExchangeRateSnapshotRequest): Promise<DeFiExchangeRateSnapshot> {
    const normalized = parseDeFiExchangeRateSnapshotRequest(request);
    const configured = this.manifest.filter((token) => token.chainId === normalized.chainId);
    const requested = selectTokens(configured, normalized.tokenIds);
    const preDeployment = requested.filter((token) => token.deploymentBlock !== undefined && BigInt(normalized.blockNumber) < BigInt(token.deploymentBlock));
    const eligible = requested.filter((token) => !preDeployment.includes(token));
    const failures: DeFiExchangeRateFailure[] = preDeployment.map((token) => failure(token, "NOT_DEPLOYED_AT_BLOCK", "Token is not deployed at the requested block."));
    if (eligible.length === 0) throw defiExchangeRateDataUnavailable("No requested DeFi token is deployed at this block.");
    const rpc = this.rpcServices.get(normalized.chainId);
    if (rpc === undefined) throw invalidRequest("DeFi is not enabled for the requested chain.");
    const calls = eligible.flatMap(adapterCalls);
    if (calls.length === 0) calls.push({ id: "__defi_block_guard", target: "0xcA11bde05977b3631167028862bE2a173976CA11", callData: `0x${MULTICALL3_GET_BLOCK_NUMBER_SELECTOR}`, allowFailure: false });
    const result = await rpc.multicallAtBlock({ chain: normalized.chainId, blockNumber: normalized.blockNumber, calls, ...(normalized.signal === undefined ? {} : { signal: normalized.signal }) });
    const byId = new Map<string, MulticallAtBlockCallResult>(result.results.map((item) => [item.id, item]));
    const rates: DeFiExchangeRate[] = [];
    for (const token of eligible) {
      try {
        const evaluation = evaluateAdapter(token, byId);
        if (evaluation.amounts.length !== token.underlyings.length) throw new Error("underlying dimension mismatch");
        rates.push(Object.freeze({ tokenId: token.id, tokenAddress: token.tokenAddress, tokenSymbol: token.tokenSymbol, tokenDecimals: token.tokenDecimals, kind: token.kind, protocol: token.protocol, underlyings: Object.freeze(token.underlyings.map((leg, index) => Object.freeze({ ...leg, amount: evaluation.amounts[index]! }))) }));
      } catch (error: unknown) {
        const code = error instanceof CallRevertedError ? "CALL_REVERTED" : error instanceof NotDeployedAtBlockError ? "NOT_DEPLOYED_AT_BLOCK" : "RESPONSE_INVALID";
        const message = code === "CALL_REVERTED" ? "Protocol call reverted at the requested block." : code === "NOT_DEPLOYED_AT_BLOCK" ? "Token has no deployed code at the requested block." : "Protocol call returned invalid data.";
        failures.push(failure(token, code, message));
      }
    }
    if (rates.length === 0) throw defiExchangeRateDataUnavailable("No requested DeFi exchange rate resolved at this block.");
    return Object.freeze({ chainId: normalized.chainId, blockNumber: normalized.blockNumber, blockHash: result.blockHash, blockTimestamp: result.blockTimestamp, registryVersion: this.version, rpcEndpointId: result.rpcEndpointId, executionMode: "multicall3", rates: Object.freeze(rates), failures: Object.freeze(failures), summary: Object.freeze({ configuredTokens: configured.length, requestedTokens: requested.length, succeededTokens: rates.length, failedTokens: failures.length, multicallBatches: result.multicallBatches, partial: failures.length > 0 }) });
  }
}

function selectTokens(configured: readonly DeFiTokenDefinition[], tokenIds: readonly string[] | null): readonly DeFiTokenDefinition[] {
  if (tokenIds === null) return configured;
  const byId = new Map(configured.map((token) => [token.id, token]));
  const selected = tokenIds.map((id) => byId.get(id));
  if (selected.some((token) => token === undefined)) throw invalidRequest("A requested DeFi tokenId is not configured for this chain.");
  return selected as DeFiTokenDefinition[];
}
function failure(token: DeFiTokenDefinition, code: DeFiExchangeRateFailure["code"], message: string): DeFiExchangeRateFailure { return Object.freeze({ tokenId: token.id, tokenAddress: token.tokenAddress, code, retryable: false, message }); }
