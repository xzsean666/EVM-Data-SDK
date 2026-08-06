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
    tokenDecimals: value.rawContract.decimals ?? null,
    from: value.from.toLowerCase(),
    to: value.to.toLowerCase(),
    amount: hexQuantityToDecimal(amount),
    provider: "alchemy",
  };
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
