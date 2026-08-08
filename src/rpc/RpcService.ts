import {
  decodeAggregate3Result,
  encodeAggregate3,
  MULTICALL3_ADDRESS,
  MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK,
  MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK,
} from "./EthereumMulticall3Codec";
import { multicallNotDeployedAtBlock, unsupportedChain } from "../domain/errors";
import {
  parseMulticallAtBlockRequest,
  type MulticallAtBlockCallResult,
  type MulticallAtBlockRequest,
  type MulticallAtBlockResult,
  type NormalizedMulticallAtBlockCall,
} from "../domain/rpcModels";

/**
 * Port implemented by `EthereumArchiveRpcExecutor` (P3). This service owns
 * public Multicall3 call validation, deterministic batching, and ABI
 * encode/decode; it has no Chainlink ABI knowledge and no endpoint URL,
 * proxy, health, or retry knowledge — that belongs entirely to the injected
 * executor.
 */
export interface ArchiveRpcMulticallExecutor {
  /**
   * Executes one or more independent `aggregate3` `eth_call` batches at the
   * exact same historical block, pinned to one endpoint for the whole
   * operation, with pre/post block-hash consistency checking. Batches are
   * returned in the same order they were submitted.
   */
  executeMulticallBatches(request: {
    readonly blockNumber: string;
    readonly multicall3Address: string;
    readonly batches: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly blockHash: string;
    /** Canonical non-negative base-10 Unix timestamp of `blockHash`. */
    readonly blockTimestamp: string;
    /** Stable configured endpoint ID only; never the endpoint URL. */
    readonly rpcEndpointId: string;
    readonly batchReturnData: readonly string[];
  }>;
}

export interface RpcServiceOptions {
  readonly executor: ArchiveRpcMulticallExecutor;
  readonly maxCallsPerMulticall?: number;
  /** Chain served by this RPC service. Defaults to Ethereum for compatibility. */
  readonly chainId?: 1 | 8453;
  readonly multicall3Address?: string;
  readonly multicall3DeploymentBlock?: string;
}

const DEFAULT_MAX_CALLS_PER_MULTICALL = 100;

/**
 * Public, provider-neutral read-only Multicall3 primitive. See
 * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md` section 3.2.
 */
export class RpcService {
  private readonly executor: ArchiveRpcMulticallExecutor;
  private readonly maxCallsPerMulticall: number;
  private readonly chainId: 1 | 8453;
  private readonly multicall3Address: string;
  private readonly multicall3DeploymentBlock: bigint;

  constructor(options: RpcServiceOptions) {
    this.executor = options.executor;
    this.maxCallsPerMulticall = options.maxCallsPerMulticall ?? DEFAULT_MAX_CALLS_PER_MULTICALL;
    this.chainId = options.chainId ?? 1;
    this.multicall3Address = options.multicall3Address ?? MULTICALL3_ADDRESS;
    this.multicall3DeploymentBlock = BigInt(
      options.multicall3DeploymentBlock ??
        (this.chainId === 1
          ? MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK
          : MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK),
    );
  }

  async multicallAtBlock(request: MulticallAtBlockRequest): Promise<MulticallAtBlockResult> {
    const normalized = parseMulticallAtBlockRequest(request);

    if (normalized.chainId !== this.chainId) {
      throw unsupportedChain("This Archive RPC service is configured for a different chain.", normalized.chainId);
    }

    if (BigInt(normalized.blockNumber) < this.multicall3DeploymentBlock) {
      throw multicallNotDeployedAtBlock(
        `Multicall3 is not deployed at block ${normalized.blockNumber} on chain ${this.chainId} ` +
          `(deployed at block ${this.multicall3DeploymentBlock}).`,
      );
    }

    const batches = chunk(normalized.calls, this.maxCallsPerMulticall);
    const encodedBatches = batches.map((batch) =>
      encodeAggregate3(
        batch.map((call) => ({
          target: call.target,
          allowFailure: call.allowFailure,
          callData: call.callData,
        })),
      ),
    );

    const execution = await this.executor.executeMulticallBatches({
      blockNumber: normalized.blockNumber,
      multicall3Address: this.multicall3Address,
      batches: encodedBatches,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    });

    if (execution.batchReturnData.length !== batches.length) {
      throw multicallNotDeployedAtBlock(
        "Archive RPC executor returned a different batch count than requested.",
      );
    }

    const results: MulticallAtBlockCallResult[] = [];
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex]!;
      const decoded = decodeAggregate3Result(execution.batchReturnData[batchIndex]!, batch.length);
      for (let callIndex = 0; callIndex < batch.length; callIndex += 1) {
        const call = batch[callIndex]!;
        const decodedCall = decoded[callIndex]!;
        results.push(
          Object.freeze({
            id: call.id,
            success: decodedCall.success,
            returnData: decodedCall.returnData,
          }),
        );
      }
    }

    return Object.freeze({
      chainId: normalized.chainId,
      blockNumber: normalized.blockNumber,
      blockHash: execution.blockHash,
      blockTimestamp: execution.blockTimestamp,
      rpcEndpointId: execution.rpcEndpointId,
      multicallBatches: batches.length,
      results: Object.freeze(results),
    });
  }
}

function chunk(
  values: readonly NormalizedMulticallAtBlockCall[],
  size: number,
): NormalizedMulticallAtBlockCall[][] {
  const batches: NormalizedMulticallAtBlockCall[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}
