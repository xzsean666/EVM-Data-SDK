/**
 * Direct-only JSON-RPC 2.0 HTTP transport for Ethereum Archive RPC.
 * Delegated to the unified base library `evm-call`.
 */
export {
  ArchiveRpcTransport,
  JsonRpcCallError,
  isJsonRpcCallError,
  type ArchiveRpcCallOptions,
  type ArchiveRpcBatchCallOptions,
  type ArchiveRpcTransportOptions,
  type JsonRpcBatchResponseItem,
} from "evm-call";
