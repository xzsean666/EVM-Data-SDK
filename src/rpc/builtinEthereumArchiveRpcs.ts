/**
 * Built-in unauthenticated public Ethereum Mainnet Archive RPC candidates.
 * Delegated to the unified base library `evm-call`.
 */
import { BUILTIN_ETHEREUM_RPCS, type BuiltinRpcEndpoint } from "evm-call";

export type BuiltinEthereumArchiveRpcCandidate = BuiltinRpcEndpoint;
export const BUILTIN_ETHEREUM_ARCHIVE_RPCS: readonly BuiltinEthereumArchiveRpcCandidate[] = BUILTIN_ETHEREUM_RPCS;
