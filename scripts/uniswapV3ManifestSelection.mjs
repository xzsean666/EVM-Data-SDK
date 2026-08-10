export function selectUniswapV3Candidates(candidates, options = {}) {
  const top = options.top === undefined ? candidates.length : options.top;
  if (!Number.isInteger(top) || top < 0) throw new Error("top must be a non-negative integer");
  const quotes = options.quotes === undefined ? null : new Set(options.quotes.map((value) => value.toLowerCase()));
  return [...candidates]
    .filter((candidate) => candidate && typeof candidate.tokenAddress === "string" && /^0x[0-9a-fA-F]{40}$/.test(candidate.tokenAddress) && typeof candidate.symbol === "string")
    .filter((candidate) => quotes === null || (typeof candidate.quoteSymbol === "string" && quotes.has(candidate.quoteSymbol.toLowerCase())))
    .sort((a, b) => a.tokenAddress.toLowerCase().localeCompare(b.tokenAddress.toLowerCase()) || a.symbol.localeCompare(b.symbol))
    .slice(0, top);
}

export function renderUniswapV3Manifest(entries, sourceSnapshot = "local") {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const seen = new Set();
  for (const entry of sorted) {
    const key = `${entry.poolAddress.toLowerCase()}|${entry.tokenAddress.toLowerCase()}|${entry.quoteTokenAddress.toLowerCase()}|${entry.feeTier}`;
    if (seen.has(key)) throw new Error("duplicate pool identity");
    seen.add(key);
  }
  return JSON.stringify({ version: "ethereum-uniswap-v3-v1", sourceSnapshot, entries: sorted }, null, 2) + "\n";
}
