/**
 * Unbiased random permutation for Archive RPC endpoint selection.
 * Delegated to the unified base library `evm-call`.
 */
export { shuffle, type RandomSource } from "evm-call";
