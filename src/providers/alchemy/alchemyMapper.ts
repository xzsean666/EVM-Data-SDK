import type { ChainDefinition } from "../../domain/chains";
import type { Erc20Transfer, NativeBalance } from "../../domain/models";
import type { AlchemyTransfer } from "./alchemySchemas";

export function mapAlchemyBalance(value: string, chain: ChainDefinition, address: string): NativeBalance {
  return {
    chainId: chain.chainId,
    address,
    amount: hexQuantityToDecimal(value),
    decimals: chain.nativeCurrency.decimals,
    symbol: chain.nativeCurrency.symbol,
    blockNumber: null,
    provider: "alchemy",
  };
}

export function mapAlchemyTransfer(value: AlchemyTransfer, chain: ChainDefinition): Erc20Transfer {
  const tokenAddress = value.rawContract.address;
  const amount = value.rawContract.value;
  if (tokenAddress === undefined || tokenAddress === null || amount === undefined || amount === null) {
    throw new Error("Alchemy transfer is missing raw contract data.");
  }
  return {
    chainId: chain.chainId,
    transactionHash: value.hash.toLowerCase(),
    transactionIndex: null,
    logIndex: null,
    blockNumber: hexQuantityToDecimal(value.blockNum),
    timestamp: mapTimestamp(value.metadata?.blockTimestamp),
    tokenAddress: tokenAddress.toLowerCase(),
    tokenName: null,
    tokenSymbol: value.asset === undefined || value.asset === null || value.asset === "" ? null : value.asset,
    // Alchemy has returned both `decimals` (number) and the legacy
    // `decimal` (hex quantity string) field across API versions. Preserve
    // either representation so a missing plural field does not discard the
    // token's unit scale.
    tokenDecimals: mapTokenDecimals(value.rawContract.decimals, value.rawContract.decimal),
    from: value.from.toLowerCase(),
    to: value.to.toLowerCase(),
    amount: hexQuantityToDecimal(amount),
    provider: "alchemy",
  };
}

function mapTokenDecimals(
  decimals: number | null | undefined,
  legacy: string | null | undefined,
): number | null {
  if (decimals !== undefined && decimals !== null) {
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : null;
  }
  if (legacy === undefined || legacy === null || legacy === "") return null;
  try {
    const parsed = /^0x/i.test(legacy) ? Number(BigInt(legacy)) : Number(legacy);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : null;
  } catch {
    return null;
  }
}

export function hexQuantityToDecimal(value: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("Alchemy returned an invalid hexadecimal quantity.");
  }
  return BigInt(value).toString(10);
}

function mapTimestamp(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Alchemy returned an invalid timestamp.");
  }
  return new Date(timestamp).toISOString();
}
