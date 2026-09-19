/**
 * Executes Multicall3 batches over Archive RPC with pre/post block-hash consistency checks.
 * Delegated to the unified base library `evm-call`.
 */
export {
  EthereumArchiveRpcExecutor,
  type EthereumArchiveRpcExecutorOptions,
} from "evm-call";
