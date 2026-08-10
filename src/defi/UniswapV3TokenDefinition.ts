import type { UniswapV3PriceAsset } from "../domain/uniswapV3HistoricalPriceModels";
export interface UniswapV3TokenDefinition {
  readonly id: string; readonly chainId: 1; readonly protocol: "uniswap-v3"; readonly tokenAddress: string; readonly tokenSymbol: string; readonly tokenDecimals: number;
  readonly poolAddress: string; readonly feeTier: number; readonly token0: UniswapV3PriceAsset; readonly token1: UniswapV3PriceAsset; readonly quoteTokenAddress: string; readonly poolDeploymentBlock: string;
}
