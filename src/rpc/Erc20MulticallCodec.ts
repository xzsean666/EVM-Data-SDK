/**
 * ERC-20 read call encoding and decoding for Multicall3.
 * Delegated to the unified base library `evm-call`.
 */
export {
  ERC20_READ_SELECTORS,
  encodeErc20Read,
  decodeErc20Read,
} from "evm-call";
