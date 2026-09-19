/**
 * Pure Multicall3 `aggregate3((address,bool,bytes)[])` ABI encode/decode.
 * Delegated to the unified base library `evm-call`.
 */
export {
  MULTICALL3_ADDRESS,
  MULTICALL3_AGGREGATE3_SELECTOR,
  MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK,
  MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK,
  MULTICALL3_GET_BLOCK_NUMBER_SELECTOR,
  encodeAggregate3,
  decodeGetBlockNumberResult,
  decodeAggregate3Result,
  type Aggregate3CallInput,
  type Aggregate3CallOutput,
} from "evm-call";
