import {
  RpcPool,
  type RpcPoolOptions,
  type RpcEndpoint,
  type EndpointCooldownState,
  type RpcOutcome,
} from "evm-call";

export interface EthereumArchiveRpcEndpoint extends RpcEndpoint {}

export interface EthereumArchiveRpcPoolOptions extends Omit<RpcPoolOptions, "chainId"> {
  readonly chainId?: number;
  readonly expectedChainId?: number;
  readonly multicall3Address?: string;
  readonly multicall3DeploymentBlock?: string | bigint;
}

export type ArchiveRpcOutcome = RpcOutcome;
export type { EndpointCooldownState };

export class EthereumArchiveRpcPool extends RpcPool {
  get expectedChainId(): number {
    return this.chainId;
  }

  constructor(options: EthereumArchiveRpcPoolOptions = {}) {
    super({
      ...options,
      chainId: options.chainId ?? options.expectedChainId ?? 1,
    });
  }
}
