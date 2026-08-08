import type { MulticallAtBlockCall, MulticallAtBlockCallResult } from "../domain/rpcModels";
import type { DeFiTokenDefinition } from "./DeFiTokenDefinition";

export interface DeFiAdapterEvaluation {
  readonly amounts: readonly string[];
}

export const WSTETH_SELECTOR = "0x035faf82";
export const AAVE_V3_POOL_GET_RESERVE_NORMALIZED_INCOME_SELECTOR = "0xd15e0053";
export const ROCKET_RETH_SELECTOR = "0xe6aa216c";
export const CBETH_EXCHANGE_RATE_SELECTOR = "0x3ba0b9a9";
export const CONVERT_TO_ASSETS_SELECTOR = "0x07a2d13a";
export const COMPOUND_EXCHANGE_RATE_STORED_SELECTOR = "0x182df0f5";
export const UNISWAP_V2_GET_RESERVES_SELECTOR = "0x0902f1ac";
export const ERC20_TOTAL_SUPPLY_SELECTOR = "0x18160ddd";
// 3pool exposes balances(uint256). 0x27e86d6e is balances(int128), which
// the pool does not implement and therefore makes every historical call revert.
export const CURVE_BALANCES_SELECTOR = "0x4903b0d1";
export const BALANCER_VAULT_GET_POOL_TOKENS_SELECTOR = "0xf94d4668";

export function adapterCalls(definition: DeFiTokenDefinition): readonly MulticallAtBlockCall[] {
  const call = (suffix: string, callData: string, target = definition.tokenAddress): MulticallAtBlockCall => ({ id: `${definition.id}::${suffix}`, target, callData, allowFailure: true });
  if (definition.adapter === "fixed-ratio") return [];
  if (definition.adapter === "aave-v2" || definition.adapter === "aave-v3") {
    const target = definition.adapter === "aave-v2"
      ? "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9"
      : definition.chainId === 1 ? "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" : "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
    return [call("income", `${AAVE_V3_POOL_GET_RESERVE_NORMALIZED_INCOME_SELECTOR}${word(definition.underlyings[0]?.address ?? definition.tokenAddress)}`, target)];
  }
  if (definition.adapter === "wsteth") return [call("rate", WSTETH_SELECTOR)];
  if (definition.adapter === "rocket-reth") return [call("rate", ROCKET_RETH_SELECTOR)];
  if (definition.adapter === "cbeth") return [call("rate", CBETH_EXCHANGE_RATE_SELECTOR)];
  if (definition.adapter === "erc4626") return [call("assets", `${CONVERT_TO_ASSETS_SELECTOR}${word(definition.sampleTokenAmount)}`)];
  if (definition.adapter === "compound-v2") return [call("rate", COMPOUND_EXCHANGE_RATE_STORED_SELECTOR)];
  if (definition.adapter === "curve-3pool-lp") {
    const pool = "0xbEbc44782C7dB0A1A60Cb6Fe97d0b483032FF1C7";
    return [0, 1, 2].map((index) => call(`balance${index}`, `${CURVE_BALANCES_SELECTOR}${word(String(index))}`, pool)).concat(call("supply", ERC20_TOTAL_SUPPLY_SELECTOR));
  }
  if (definition.adapter === "aerodrome-lp") return [call("reserves", UNISWAP_V2_GET_RESERVES_SELECTOR), call("supply", ERC20_TOTAL_SUPPLY_SELECTOR)];
  if (definition.adapter === "balancer-bpt") {
    if (definition.adapterTarget === undefined || definition.adapterPoolId === undefined || !/^[0-9a-fA-F]{64}$/.test(definition.adapterPoolId)) throw new Error("invalid Balancer adapter metadata");
    return [call("poolTokens", `${BALANCER_VAULT_GET_POOL_TOKENS_SELECTOR}${definition.adapterPoolId}`, definition.adapterTarget), call("supply", ERC20_TOTAL_SUPPLY_SELECTOR)];
  }
  return [call("reserves", UNISWAP_V2_GET_RESERVES_SELECTOR), call("supply", ERC20_TOTAL_SUPPLY_SELECTOR)];
}

export function evaluateAdapter(definition: DeFiTokenDefinition, byId: ReadonlyMap<string, MulticallAtBlockCallResult>): DeFiAdapterEvaluation {
  if (definition.adapter === "fixed-ratio") return Object.freeze({ amounts: Object.freeze(definition.underlyings.map(() => definition.sampleTokenAmount)) });
  const result = (suffix: string): MulticallAtBlockCallResult => {
    const value = byId.get(`${definition.id}::${suffix}`);
    if (value === undefined) throw new Error("missing result");
    if (!value.success) throw new CallRevertedError();
    if (value.returnData === "0x") throw new NotDeployedAtBlockError();
    return value;
  };
  if (definition.adapter === "aave-v2" || definition.adapter === "aave-v3") {
    const income = decodeUint(result("income").returnData);
    const amount = BigInt(definition.sampleTokenAmount) * income / 10n ** 27n;
    if (amount <= 0n) throw new Error("invalid Aave normalized income");
    return Object.freeze({ amounts: Object.freeze([amount.toString()]) });
  }
  if (definition.adapter === "wsteth" || definition.adapter === "rocket-reth" || definition.adapter === "cbeth" || definition.adapter === "erc4626") {
    return Object.freeze({ amounts: Object.freeze([decodeUint(result(definition.adapter === "erc4626" ? "assets" : "rate").returnData).toString()]) });
  }
  if (definition.adapter === "compound-v2") {
    const mantissa = decodeUint(result("rate").returnData);
    const amount = BigInt(definition.sampleTokenAmount) * mantissa / 10n ** 18n;
    if (amount <= 0n) throw new Error("invalid amount");
    return Object.freeze({ amounts: Object.freeze([amount.toString()]) });
  }
  if (definition.adapter === "curve-3pool-lp") {
    const supply = decodeUint(result("supply").returnData);
    const sample = BigInt(definition.sampleTokenAmount);
    const amounts = [0, 1, 2].map((index) => decodeUint(result(`balance${index}`).returnData) * sample / supply);
    if (amounts.some((amount) => amount <= 0n)) throw new Error("invalid Curve balances");
    return Object.freeze({ amounts: Object.freeze(amounts.map(String)) });
  }
  if (definition.adapter === "balancer-bpt") {
    const [tokens, balances] = decodeBalancerPoolTokens(result("poolTokens").returnData);
    const expected = definition.underlyings.map((leg) => leg.address?.toLowerCase());
    const supply = decodeUint(result("supply").returnData);
    const sample = BigInt(definition.sampleTokenAmount);
    const amounts = expected.map((address) => {
      const index = tokens.findIndex((token) => token === address);
      if (index < 0) throw new Error("Balancer token metadata mismatch");
      return balances[index]! * sample / supply;
    });
    if (amounts.some((amount) => amount <= 0n)) throw new Error("invalid Balancer balances");
    return Object.freeze({ amounts: Object.freeze(amounts.map(String)) });
  }
  const [reserve0, reserve1] = decodeReserves(result("reserves").returnData);
  const supply = decodeUint(result("supply").returnData);
  if (supply === 0n) throw new Error("zero supply");
  const sample = BigInt(definition.sampleTokenAmount);
  const amounts = [reserve0 * sample / supply, reserve1 * sample / supply];
  if (amounts.some((amount) => amount <= 0n)) throw new Error("invalid reserves");
  return Object.freeze({ amounts: Object.freeze(amounts.map(String)) });
}

export class CallRevertedError extends Error {}
export class NotDeployedAtBlockError extends Error {}

function word(value: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return value.slice(2).padStart(64, "0").toLowerCase();
  return BigInt(value).toString(16).padStart(64, "0");
}

function decodeUint(value: string): bigint {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("malformed uint256");
  const decoded = BigInt(value);
  if (decoded <= 0n) throw new Error("zero uint256");
  return decoded;
}

function decodeReserves(value: string): readonly [bigint, bigint] {
  if (!/^0x[0-9a-fA-F]{192}$/.test(value)) throw new Error("malformed reserves");
  const reserve0 = BigInt(`0x${value.slice(2, 66)}`);
  const reserve1 = BigInt(`0x${value.slice(66, 130)}`);
  if (reserve0 <= 0n || reserve1 <= 0n) throw new Error("zero reserve");
  return [reserve0, reserve1];
}

function decodeBalancerPoolTokens(value: string): readonly [readonly string[], readonly bigint[]] {
  if (!/^0x[0-9a-fA-F]+$/.test(value) || value.length < 2 + 192) throw new Error("malformed Balancer pool tokens");
  const wordAt = (byteOffset: number): bigint => BigInt(`0x${value.slice(2 + byteOffset * 2, 2 + (byteOffset + 32) * 2)}`);
  const tokensOffset = Number(wordAt(0));
  const balancesOffset = Number(wordAt(32));
  const tokenCount = Number(wordAt(tokensOffset));
  const balanceCount = Number(wordAt(balancesOffset));
  if (tokenCount === 0 || tokenCount !== balanceCount || tokenCount > 32) throw new Error("invalid Balancer pool token arrays");
  const tokens = Array.from({ length: tokenCount }, (_, index) => `0x${value.slice(2 + (tokensOffset + 32 + index * 32 + 12) * 2, 2 + (tokensOffset + 32 + index * 32 + 32) * 2).toLowerCase()}`);
  const balances = Array.from({ length: balanceCount }, (_, index) => wordAt(balancesOffset + 32 + index * 32));
  return [tokens, balances];
}
