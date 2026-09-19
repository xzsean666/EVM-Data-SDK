# DeFi protocol inventory

This inventory defines the scope of the default exchange-rate registry. It is
an auditable allowlist, not a runtime token discovery mechanism.

The exact DeFiLlama scope snapshot is exported as `DEFI_PROTOCOL_SCOPE` from
`src/defi/defiProtocolScope.ts`: 50 non-CEX/non-bridge DeFi protocols per
chain, captured on 2026-08-08.

## Selection rule

The candidate set is the prominent, liquid protocols appearing in the public
TVL rankings for Ethereum or Base (reviewed 2026-08-08). A candidate is added
only when all of the following are true:

1. The token and underlying addresses are published by the protocol or an
   official protocol address book.
2. The exchange-rate ABI and raw-unit semantics are documented well enough to
   calculate an exact historical-block value.
3. Every underlying has an asset identity in the committed Chainlink
   Ethereum manifest.
4. The address has independently verified bytecode on its target chain.

TVL rankings are evidence for prominence only; they are never used as an
address or rate source.

## Included

| Chain | Protocol/token family | Registry status |
| --- | --- | --- |
| Ethereum | Lido `stETH`, `wstETH` | Included; official contracts and exact exchange-rate calls |
| Ethereum | Rocket Pool `rETH` | Included; official contract and exact exchange-rate call |
| Ethereum | Aave V2/V3 aTokens | Included; official Aave address book and normalized-income math |
| Base | Aave V3 aTokens | Included; official Aave address book and normalized-income math (Chainlink intersection currently 8 assets) |
| Ethereum | Compound V2 cTokens | Included; `exchangeRateStored()` exact raw-unit math |
| Ethereum | Sky/Maker `sDAI` | Included; ERC-4626 `convertToAssets()` |
| Ethereum | Sky `sUSDS` and Ethena `sUSDe` | Included; ERC-4626 `convertToAssets()` with Chainlink-covered USDS/USDe underlyings |
| Ethereum | Frax `sFRAX` | Included; ERC-4626 `convertToAssets()` with Chainlink-covered FRAX underlying |
| Ethereum | Uniswap V2 WETH/USDC LP | Included; reserves and total-supply calculation |
| Ethereum | Curve 3pool `3Crv` | Included; official pool balances and total-supply calculation |
| Ethereum | Compound V3 Comet markets | Included for official USDC/WETH/wstETH/USDT/USDS/WBTC deployments; Comet balances are base-token units |
| Base | Compound V3 Comet markets | Included for official USDC/WETH/USDS deployments; Comet balances are base-token units |
| Base | Aerodrome WETH/USDC volatile LP | Included; pool address is committed from the official Aerodrome PoolFactory lookup |
| Ethereum | Balancer 80 BAL / 20 WETH BPT | Included; official Balancer poolId and Vault token balances are committed |
| Ethereum/Base | Morpho MetaMorpho ERC-4626 vaults | Included for high-liquidity USDC/USDT/EURC vaults; official Morpho API addresses and `convertToAssets()` |
| Base | Moonwell markets | Included for USDC/ETH/wstETH/cbBTC/DAI/EURC/USDS/tBTC; official Moonwell SDK market list and `exchangeRateStored()` |
| Base | Moonwell Vaults | Included for mwETH/mwUSDC/mwEURC; official Moonwell SDK vault list and ERC-4626 `convertToAssets()` |

## Not yet included

These are prominent candidates, but are intentionally not represented by a
guessed address, a market-price API, or a fixed 1:1 approximation:

| Protocol/family | Reason |
| --- | --- |
| Compound V3 collateral markets | Collateral positions are not fungible exchange-rate tokens; only the base-token Comet ERC-20 balance units are represented. |
| Morpho Blue markets | A market is identified by a `(loanToken, collateralToken, oracle, irm, lltv)` tuple rather than one fungible exchange-rate token. MetaMorpho vault shares are included separately as ERC-4626 tokens. |
| Curve LP tokens outside 3pool | Exact per-underlying amounts require pool balances, coin discovery, and pool-specific ABI handling; a single virtual-price call is insufficient. |
| Balancer BPT | Exact proportional underlying amounts require Vault pool-id and token-list metadata, not only the BPT address. |
| Uniswap V3 positions | Positions are ERC-721s with range-dependent amounts, not fungible exchange-rate tokens. |
| Aerodrome pools other than WETH/USDC volatile | Pool addresses and stable/volatile metadata must be committed individually; no runtime factory discovery is used. |
| Balancer pools other than 80 BAL / 20 WETH | PoolId/token metadata must be committed individually; no runtime Vault discovery is used. |
| Pendle/Yield tokens | Maturity and market state determine redemption; a generic historical exchange-rate adapter is not defined yet. |
| Base-native Chainlink-dependent assets | The committed feed manifest currently covers Ethereum Mainnet identities; Base-native feed manifests are a separate, pending scope. |

The default registry therefore represents the complete set that currently
meets the safety and exactness contract above. Expanding it requires an
official address/ABI source, fixtures, and an opt-in live bytecode check.
