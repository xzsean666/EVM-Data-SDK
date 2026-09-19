/**
 * Built-in unauthenticated public Base Mainnet Archive RPC candidates.
 * Delegated to the unified base library `evm-call`.
 */
import { BUILTIN_BASE_RPCS, type BuiltinRpcEndpoint } from "evm-call";

export type BuiltinBaseArchiveRpcCandidate = BuiltinRpcEndpoint;
export const BUILTIN_BASE_ARCHIVE_RPCS: readonly BuiltinBaseArchiveRpcCandidate[] = BUILTIN_BASE_RPCS;
