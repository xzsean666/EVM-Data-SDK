/**
 * DeFiLlama TVL scope snapshot, retrieved 2026-08-08.
 * CEX, bridge, and chain categories are excluded because they do not expose
 * a DeFi token exchange-rate surface on Ethereum or Base.
 */
export const DEFI_PROTOCOL_SCOPE = Object.freeze({
  ethereum: Object.freeze([
    "lido", "aave-v3", "ssv-network", "binance-staked-eth", "sky-lending", "eigencloud", "ethena-usde", "sparklend", "morpho-blue", "ether.fi-stake",
    "tether-gold", "maple", "paxos-gold", "grove-finance", "spark-liquidity-layer", "ondo-yield-assets", "centrifuge-protocol", "falcon-finance", "curve-dex", "blackrock-buidl",
    "sentora", "compound-v3", "rocket-pool", "spark-savings", "steakhouse-financial", "kelp", "anemoy-capital", "uniswap-v3", "invesco-ustb", "wisdomtree",
    "concrete", "stakewise-v2", "pendle", "uniswap-v2", "uniswap-v4", "ondo-global-markets", "liquid-collective", "tornado-cash", "obol", "fluid-lending",
    "meth-protocol", "convex-finance", "veda", "coinbase-wrapped-staked-eth", "ethena-usdtb", "hastra", "symbiotic", "gauntlet", "cap", "m0",
  ]),
  base: Object.freeze([
    "morpho-blue", "steakhouse-financial", "gauntlet", "aave-v3", "grove-finance", "uniswap-v3", "aerodrome-slipstream", "aerodrome-v1", "afi-protocol", "uniswap-v2",
    "aera-v3", "clearstar", "centrifuge-protocol", "uniswap-v4", "moonwell-lending", "spiko", "yo-protocol", "derive-v2", "40-acres", "t-rize",
    "bitfi-basis", "extra-finance-leverage-farming", "river-omni-cdp", "fusion-by-ipor", "pancakeswap-amm-v3", "anthias-labs", "moonwell-vaults", "avantis", "compound-v3", "block-analitica",
    "vfat.io", "fluid-lending", "beefy", "euler-v2", "aerodrome-ignition", "chamber-vaults", "arrakis-modular", "curve-dex", "harvest-finance", "spark-savings",
    "kasu", "uncx-network-v3", "zyfai", "anzen-v2", "bitbond-lockers", "stargate-v2", "autofinance", "brickken", "tau-labs", "arcadia-v2",
  ]),
} as const);

export type DeFiProtocolScopeChain = keyof typeof DEFI_PROTOCOL_SCOPE;
