import type { Erc20MulticallCall, Erc20ReadMethod } from "../domain/erc20MulticallModels";

export const ERC20_READ_SELECTORS = Object.freeze({
  balanceOf: "70a08231",
  allowance: "dd62ed3e",
  decimals: "313ce567",
  name: "06fdde03",
  symbol: "95d89b41",
  totalSupply: "18160ddd",
});

export function encodeErc20Read(call: Erc20MulticallCall): string {
  switch (call.method) {
    case "balanceOf": return `0x${ERC20_READ_SELECTORS.balanceOf}${wordAddress(call.owner)}`;
    case "allowance": return `0x${ERC20_READ_SELECTORS.allowance}${wordAddress(call.owner)}${wordAddress(call.spender)}`;
    case "decimals": return `0x${ERC20_READ_SELECTORS.decimals}`;
    case "name": return `0x${ERC20_READ_SELECTORS.name}`;
    case "symbol": return `0x${ERC20_READ_SELECTORS.symbol}`;
    case "totalSupply": return `0x${ERC20_READ_SELECTORS.totalSupply}`;
  }
}

export function decodeErc20Read(method: Erc20ReadMethod, returnData: string): string {
  if (typeof returnData !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(returnData)) {
    throw new Error("ERC-20 return data must be even-length hex.");
  }
  const hex = returnData.slice(2);
  if (method === "name" || method === "symbol") return decodeText(hex);
  if (hex.length !== 64) throw new Error("ERC-20 uint return data must be exactly one word.");
  const value = BigInt(`0x${hex}`);
  if (method === "decimals" && value > 255n) throw new Error("ERC-20 decimals is out of range.");
  return value.toString(10);
}

function wordAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("ERC-20 argument must be a 20-byte address.");
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function decodeText(hex: string): string {
  if (hex.length === 64) return decodeBytes32(hex);
  if (hex.length < 128) throw new Error("ERC-20 text return data is truncated.");
  const offset = BigInt(`0x${hex.slice(0, 64)}`);
  if (offset !== 32n) throw new Error("ERC-20 text return data has an invalid offset.");
  const length = Number(BigInt(`0x${hex.slice(64, 128)}`));
  if (!Number.isSafeInteger(length) || length < 0 || 128 + length * 2 > hex.length) throw new Error("ERC-20 text return data is truncated.");
  const bytes = hex.slice(128, 128 + length * 2);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes.match(/../g)!.map((value) => Number.parseInt(value, 16))));
  } catch {
    throw new Error("ERC-20 text return data is not valid UTF-8.");
  }
}

function decodeBytes32(hex: string): string {
  const bytes = hex.match(/../g)!.map((value) => Number.parseInt(value, 16));
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes.slice(0, end)));
}
