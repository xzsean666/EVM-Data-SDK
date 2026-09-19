/**
 * JSON-RPC 2.0 batch execution engine with chunking, bounded concurrency, and failover.
 * Delegated to the unified base library `evm-call`.
 */
export {
  JsonRpcBatchExecutor,
  type JsonRpcBatchExecutorOptions,
  type RpcPoolLike,
  type RpcEndpoint,
} from "evm-call";
