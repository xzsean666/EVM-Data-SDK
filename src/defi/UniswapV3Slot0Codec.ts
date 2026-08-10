export const UNISWAP_V3_SLOT0_SELECTOR = "0x3850c7bd";
export interface UniswapV3Slot0 { readonly sqrtPriceX96: bigint; readonly tick: number; }
export function decodeUniswapV3Slot0(returnData: string): UniswapV3Slot0 {
  if (typeof returnData !== "string" || !/^0x[0-9a-fA-F]{448}$/.test(returnData)) throw new Error("Invalid Uniswap V3 slot0 response.");
  const word = (index: number) => BigInt(`0x${returnData.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
  const sqrt = word(0); if (sqrt <= 0n || sqrt >= (1n << 160n)) throw new Error("Invalid Uniswap V3 sqrt price.");
  const tickWord = word(1); const tickValue = Number(tickWord & ((1n << 24n) - 1n)); const tick = (tickValue & (1 << 23)) !== 0 ? tickValue - (1 << 24) : tickValue;
  const upper = tickWord >> 24n;
  if ((tick < 0 && upper !== ((1n << 232n) - 1n)) || (tick >= 0 && upper !== 0n)) throw new Error("Invalid Uniswap V3 signed tick encoding.");
  if (tick < -887272 || tick > 887272) throw new Error("Invalid Uniswap V3 tick.");
  if (word(6) !== 0n && word(6) !== 1n) throw new Error("Invalid Uniswap V3 bool.");
  return Object.freeze({ sqrtPriceX96: sqrt, tick });
}
