const Q96 = 1n << 96n;
const Q192 = 1n << 192n;
const MAX_TICK = 887272;
const constants = [0xfffcb933bd6fad37aa2d162d1a594001n,0xfff97272373d413259a46990580e213an,0xfff2e50f5f656932ef12357cf3c7fdccn,0xffe5caca7e10e4e61c3624eaa0941cd0n,0xffcb9843d60f6159c9db58835c926644n,0xff973b41fa98c081472e6896dfb254c0n,0xff2ea16466c96a3843ec78b326b52861n,0xfe5dee046a99a2a811c461f1969c3053n,0xfcbe86c7900a88aedcffc83b479aa3a4n,0xf987a7253ac413176f2b074cf7815e54n,0xf3392b0822b70005940c7a398e4b70f3n,0xe7159475a2c29b7443b29c7fa6e889d9n,0xd097f3bdfd2022b8845ad8f792aa5825n,0xa9f746462d870fdf8a65dc1f90e061e5n,0x70d869a156d2a1b890bb3df62baf32f7n,0x31be135f97d08fd981231505542fcfa6n,0x9aa508b5b7a84e1c677de54f3e99bc9n,0x5d6af8dedb81196699c329225ee604n,0x2216e584f5fa1ea926041bedfe98n,0x48a170391f7dc42444e8fa2n];
export function getSqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < -MAX_TICK || tick > MAX_TICK) throw new Error("Tick out of range.");
  let ratio = (tick & 1) !== 0 ? constants[0]! : 0x100000000000000000000000000000000n;
  let abs = tick < 0 ? -tick : tick;
  for (let i = 1; i < constants.length; i += 1) if ((abs & (1 << i)) !== 0) ratio = (ratio * constants[i]!) >> 128n;
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}
function pow10(decimals: number): bigint { if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Invalid decimals."); return 10n ** BigInt(decimals); }
function renderScaled(value: bigint, scale: number): string { const base = 10n ** BigInt(scale); const whole = value / base; const fraction = (value % base).toString().padStart(scale, "0").replace(/0+$/, ""); return fraction ? `${whole}.${fraction}` : whole.toString(); }
export interface UniswapV3Ratio { readonly numerator: bigint; readonly denominator: bigint; readonly display: string; }
export function ratioForSqrtPrice(sqrtPriceX96: bigint, tick: number, baseIsToken0: boolean, token0Decimals: number, token1Decimals: number): { spot: UniswapV3Ratio; tick: UniswapV3Ratio } {
  if (sqrtPriceX96 <= 0n) throw new Error("Invalid sqrt price.");
  const rawNumerator = sqrtPriceX96 * sqrtPriceX96;
  const spot = normalizeRatio(baseIsToken0 ? rawNumerator * pow10(token0Decimals) : Q192 * pow10(token1Decimals), baseIsToken0 ? Q192 * pow10(token1Decimals) : rawNumerator * pow10(token0Decimals));
  const tickSqrt = getSqrtRatioAtTick(tick); const tickRaw = tickSqrt * tickSqrt;
  const tickRatio = normalizeRatio(baseIsToken0 ? tickRaw * pow10(token0Decimals) : Q192 * pow10(token1Decimals), baseIsToken0 ? Q192 * pow10(token1Decimals) : tickRaw * pow10(token0Decimals));
  return { spot, tick: tickRatio };
}
function normalizeRatio(numerator: bigint, denominator: bigint): UniswapV3Ratio { if (numerator <= 0n || denominator <= 0n) throw new Error("Invalid ratio."); return Object.freeze({ numerator, denominator, display: renderScaled((numerator * (10n ** 18n)) / denominator, 18) }); }
export { Q96, Q192, MAX_TICK };
