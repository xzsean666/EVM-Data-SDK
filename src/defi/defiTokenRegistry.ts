import { createHash } from "node:crypto";

import type { DeFiTokenDefinition } from "./DeFiTokenDefinition";

const eth = (id: string, protocol: string, kind: DeFiTokenDefinition["kind"], tokenAddress: string, tokenSymbol: string, tokenDecimals: number, underlyings: DeFiTokenDefinition["underlyings"], adapter: DeFiTokenDefinition["adapter"], chainlinkAssetSymbol?: string, adapterTarget?: string, adapterPoolId?: string): DeFiTokenDefinition => Object.freeze({ id, chainId: 1, protocol, kind, tokenAddress, tokenSymbol, tokenDecimals, underlyings: Object.freeze(underlyings.map((leg) => Object.freeze(leg))), adapter, sampleTokenAmount: (10n ** BigInt(tokenDecimals)).toString(), ...(chainlinkAssetSymbol === undefined ? {} : { chainlinkAssetSymbol }), ...(adapterTarget === undefined ? {} : { adapterTarget }), ...(adapterPoolId === undefined ? {} : { adapterPoolId }) });
const base = (id: string, protocol: string, kind: DeFiTokenDefinition["kind"], tokenAddress: string, tokenSymbol: string, tokenDecimals: number, underlyings: DeFiTokenDefinition["underlyings"], adapter: DeFiTokenDefinition["adapter"], chainlinkAssetSymbol?: string): DeFiTokenDefinition => Object.freeze({ id, chainId: 8453, protocol, kind, tokenAddress, tokenSymbol, tokenDecimals, underlyings: Object.freeze(underlyings.map((leg) => Object.freeze(leg))), adapter, sampleTokenAmount: (10n ** BigInt(tokenDecimals)).toString(), ...(chainlinkAssetSymbol === undefined ? {} : { chainlinkAssetSymbol }) });
const nativeEth = Object.freeze({ address: null, symbol: "ETH", decimals: 18, isNative: true, chainlinkAssetSymbol: "ETH" });
const weth = Object.freeze({ address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18, isNative: false, chainlinkAssetSymbol: "ETH" });
const aaveEth = (key: string, symbol: string, token: string, underlying: string, decimals: number, chainlinkAssetSymbol = symbol): DeFiTokenDefinition => eth(`ethereum:aave-v3:a${key.toLowerCase()}`, "aave-v3", "lending", token, `a${symbol}`, decimals, [{ address: underlying, symbol, decimals, isNative: false, chainlinkAssetSymbol }], "aave-v3", chainlinkAssetSymbol);
const aaveBase = (key: string, symbol: string, token: string, underlying: string, decimals: number, chainlinkAssetSymbol = symbol): DeFiTokenDefinition => base(`base:aave-v3:a${key.toLowerCase()}`, "aave-v3", "lending", token, `a${symbol}`, decimals, [{ address: underlying, symbol, decimals, isNative: false, chainlinkAssetSymbol }], "aave-v3", chainlinkAssetSymbol);
const cometEth = (key: string, symbol: string, token: string, underlying: string, decimals: number, chainlinkAssetSymbol: string): DeFiTokenDefinition => eth(`ethereum:compound-v3:${key.toLowerCase()}`, "compound-v3", "lending", token, `c${symbol}`, decimals, [{ address: underlying, symbol, decimals, isNative: false, chainlinkAssetSymbol }], "fixed-ratio", chainlinkAssetSymbol);
const cometBase = (key: string, symbol: string, token: string, underlying: string, decimals: number, chainlinkAssetSymbol: string): DeFiTokenDefinition => base(`base:compound-v3:${key.toLowerCase()}`, "compound-v3", "lending", token, `c${symbol}`, decimals, [{ address: underlying, symbol, decimals, isNative: false, chainlinkAssetSymbol }], "fixed-ratio", chainlinkAssetSymbol);
const morphoEth = (key: string, symbol: string, token: string, underlying: string, underlyingSymbol: string, chainlinkAssetSymbol: string): DeFiTokenDefinition => eth(`ethereum:morpho:${key}`, "morpho", "vault", token, symbol, 18, [{ address: underlying, symbol: underlyingSymbol, decimals: 6, isNative: false, chainlinkAssetSymbol }], "erc4626", chainlinkAssetSymbol);
const morphoBase = (key: string, symbol: string, token: string, underlying: string, underlyingSymbol: string, chainlinkAssetSymbol: string): DeFiTokenDefinition => base(`base:morpho:${key}`, "morpho", "vault", token, symbol, 18, [{ address: underlying, symbol: underlyingSymbol, decimals: 6, isNative: false, chainlinkAssetSymbol }], "erc4626", chainlinkAssetSymbol);
const moonwellBase = (key: string, symbol: string, token: string, underlying: string | null, underlyingSymbol: string, decimals: number, chainlinkAssetSymbol: string, isNative = false): DeFiTokenDefinition => base(`base:moonwell:${key}`, "moonwell", "lending", token, symbol, 8, [{ address: underlying, symbol: underlyingSymbol, decimals, isNative, chainlinkAssetSymbol }], "compound-v2", chainlinkAssetSymbol);

export const DEFI_TOKEN_REGISTRY: readonly DeFiTokenDefinition[] = Object.freeze([
  eth("ethereum:lido:steth", "lido", "lst", "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", "stETH", 18, [nativeEth], "fixed-ratio", "ETH"),
  eth("ethereum:lido:wsteth", "lido", "lst", "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", "wstETH", 18, [{ address: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", symbol: "stETH", decimals: 18, isNative: false, chainlinkAssetSymbol: "STETH" }], "wsteth", "STETH"),
  eth("ethereum:rocket-pool:reth", "rocket-pool", "lst", "0xae78736cd615f374d3085123a210448e74fc6393", "rETH", 18, [nativeEth], "rocket-reth", "ETH"),
  eth("ethereum:coinbase:cbeth", "coinbase", "lst", "0xbe9895146f7af43049ca1c1ae358b0541ea49704", "cbETH", 18, [nativeEth], "cbeth", "ETH"),
  eth("ethereum:compound-v2:cdai", "compound-v2", "lending", "0xf5dce57282a584d2746faf1593d3121fcac444dc", "cDAI", 8, [{ address: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", decimals: 18, isNative: false, chainlinkAssetSymbol: "DAI" }], "compound-v2", "DAI"),
  eth("ethereum:compound-v2:cusdc", "compound-v2", "lending", "0x39aa39c021dfbae8fac545936693ac917d5e7563", "cUSDC", 8, [{ address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDC" }], "compound-v2", "USDC"),
  eth("ethereum:compound-v2:cwbtc", "compound-v2", "lending", "0xccf4429db6322d5c611ee964527d42e5d685dd6a", "cWBTC", 8, [{ address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC", decimals: 8, isNative: false, chainlinkAssetSymbol: "BTC" }], "compound-v2", "BTC"),
  eth("ethereum:aave-v2:adai", "aave-v2", "lending", "0x028171bCA77440897B824Ca71D1c56caC55b68A3", "aDAI", 18, [{ address: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", decimals: 18, isNative: false, chainlinkAssetSymbol: "DAI" }], "aave-v2", "DAI"),
  eth("ethereum:aave-v2:ausdc", "aave-v2", "lending", "0xBcca60bB61934080951369a648Fb03DF4F96263C", "aUSDC", 6, [{ address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDC" }], "aave-v2", "USDC"),
  eth("ethereum:sky:sdai", "sky", "vault", "0x83f20f44975d03b1b09e64809b757c47f942beea", "sDAI", 18, [{ address: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", decimals: 18, isNative: false, chainlinkAssetSymbol: "DAI" }], "erc4626", "DAI"),
  eth("ethereum:sky:susds", "sky", "vault", "0xa3931d71877c0e7a3148cb7eb4463524fec27fbd", "sUSDS", 18, [{ address: "0xdC035D45d973E3EC169d2276DDab16f1e407384F", symbol: "USDS", decimals: 18, isNative: false, chainlinkAssetSymbol: "USDS" }], "erc4626", "USDS"),
  eth("ethereum:ethena:susde", "ethena", "vault", "0x9d39a5de30e57443bff2a8307a4256c8797a3497", "sUSDe", 18, [{ address: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3", symbol: "USDe", decimals: 18, isNative: false, chainlinkAssetSymbol: "USDE" }], "erc4626", "USDE"),
  eth("ethereum:frax:sfrax", "frax", "vault", "0xa663b02cf0a4b149d2ad41910cb81e23e1c41c32", "sFRAX", 18, [{ address: "0x853d955aCEf822Db058eb8505911ED77F175b99e", symbol: "FRAX", decimals: 18, isNative: false, chainlinkAssetSymbol: "FRAX" }], "erc4626", "FRAX"),
  eth("ethereum:uniswap-v2:weth-usdc", "uniswap-v2", "lp", "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", "UNI-V2", 18, [weth, { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDC" }], "uniswap-v2-lp"),
  eth("ethereum:curve:3pool", "curve", "lp", "0x6c3f90f043a72fa612cbac8115ee7e52bde6e490", "3Crv", 18, [
    { address: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", decimals: 18, isNative: false, chainlinkAssetSymbol: "DAI" },
    { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDC" },
    { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", symbol: "USDT", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDT" },
  ], "curve-3pool-lp"),
  eth("ethereum:balancer:80bal-20weth", "balancer", "lp", "0x5c6ee304399dbdb9c8ef030ab642b10820db8f56", "B-80BAL-20WETH", 18, [
    { address: "0xba100000625a3754423978a60c9317c58a424e3d", symbol: "BAL", decimals: 18, isNative: false, chainlinkAssetSymbol: "BAL" },
    weth,
  ], "balancer-bpt", undefined, "0xba12222222228d8ba445958a75a0704d566bf2c8", "5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014"),
  eth("ethereum:balancer:20wsteth-80aave", "balancer", "lp", "0x3de27efa2f1aa663ae5d458857e731c129069f29", "B-20wstETH-80AAVE", 18, [
    { address: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", symbol: "wstETH", decimals: 18, isNative: false, chainlinkAssetSymbol: "STETH" },
    { address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", symbol: "AAVE", decimals: 18, isNative: false, chainlinkAssetSymbol: "AAVE" },
  ], "balancer-bpt", undefined, "0xba12222222228d8ba445958a75a0704d566bf2c8", "3de27efa2f1aa663ae5d458857e731c129069f29000200000000000000000588"),
  eth("ethereum:balancer:50wbtc-50weth", "balancer", "lp", "0xa6f548df93de924d73be7d25dc02554c6bd66db5", "B-50WBTC-50WETH", 18, [
    { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", symbol: "WBTC", decimals: 8, isNative: false, chainlinkAssetSymbol: "BTC" },
    weth,
  ], "balancer-bpt", undefined, "0xba12222222228d8ba445958a75a0704d566bf2c8", "a6f548df93de924d73be7d25dc02554c6bd66db500020000000000000000000e"),
  cometEth("USDC", "USDC", "0xc3d688B66703497DAA19211EEdff47f25384cdc3", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6, "USDC"),
  cometEth("WETH", "WETH", "0xA17581A9E3356d9A858b789D68B4d866e593aE94", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", 18, "ETH"),
  cometEth("wstETH", "wstETH", "0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3", "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", 18, "STETH"),
  cometEth("USDT", "USDT", "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6, "USDT"),
  cometEth("USDS", "USDS", "0x5D409e56D886231aDAf00c8775665AD0f9897b56", "0xdC035D45d973E3EC169d2276DDab16f1e407384F", 18, "USDS"),
  cometEth("WBTC", "WBTC", "0xe85Dc543813B8c2CFEaAc371517b925a166a9293", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8, "BTC"),
  morphoEth("adpusdc", "adpUSDC", "0x55555815a5595991C3A0Ff119B59AEF6C8B55555", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USDC"),
  morphoEth("steakusdt", "steakUSDT", "0xbEef047a543E45807105E51A8BBEFCc5950fcfBa", "0xdAC17F958D2ee523a2206206994597C13D831ec7", "USDT", "USDT"),
  morphoEth("steakusdc", "steakUSDC", "0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USDC"),
  morphoEth("1337usdc", "1337USDC", "0x94643e86aa5E38DDAc6c7791C1297f4E40cD96c1", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USDC"),
  morphoEth("gtusdc", "gtUSDC", "0xdd0f28e19C1780eb6396170735D45153D261490d", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USDC"),
  aaveEth("WETH", "WETH", "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18, "ETH"),
  aaveEth("wstETH", "wstETH", "0x0B925eD163218f6662a35e0f0371Ac234f9E9371", "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", 18, "STETH"),
  aaveEth("WBTC", "WBTC", "0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8, "BTC"),
  aaveEth("USDC", "USDC", "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
  aaveEth("DAI", "DAI", "0x018008bfb33d285247A21d44E50697654f754e63", "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
  aaveEth("LINK", "LINK", "0x5E8C8A7243651DB1384C0dDfDbE39761E8e7E51a", "0x514910771AF9Ca656af840dff83E8264EcF986CA", 18),
  aaveEth("AAVE", "AAVE", "0xA700b4eB416Be35b2911fd5Dee80678ff64fF6C9", "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", 18),
  aaveEth("USDT", "USDT", "0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
  aaveEth("LUSD", "LUSD", "0x3Fe6a295459FAe07DF8A0ceCC36F37160FE86AA9", "0x5f98805A4E8be255a32880FDeC7F6728C6568bA0", 18),
  aaveEth("CRV", "CRV", "0x7B95Ec873268a6BFC6427e7a28e396Db9D0ebc65", "0xD533a949740bb3306d119CC777fa900bA034cd52", 18),
  aaveEth("MKR", "MKR", "0x8A458A9dc9048e005d22849F470891b840296619", "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2", 18),
  aaveEth("SNX", "SNX", "0xC7B4c17861357B8ABB91F25581E7263E08DCB59c", "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F", 18),
  aaveEth("BAL", "BAL", "0x2516E7B3F76294e03C42AA4c5b5b4DCE9C436fB8", "0xba100000625a3754423978a60c9317c58a424e3D", 18),
  aaveEth("UNI", "UNI", "0xF6D2224916DDFbbab6e6bd0D1B7034f4Ae0CaB18", "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18),
  aaveEth("ENS", "ENS", "0x545bD6c032eFdde65A377A6719DEF2796C8E0f2e", "0xC18360217D8F7Ab5e7c516566761Ea12Ce7F9D72", 18),
  aaveEth("1INCH", "1INCH", "0x71Aef7b30728b9BB371578f36c5A1f1502a5723e", "0x111111111117dC0aa78b770fA6A738034120C302", 18),
  aaveEth("FRAX", "FRAX", "0xd4e245848d6E1220DBE62e155d89fa327E43CB06", "0x853d955aCEf822Db058eb8505911ED77F175b99e", 18),
  aaveEth("GHO", "GHO", "0x00907f9921424583e7ffBfEdf84F92B7B2Be4977", "0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f", 18),
  aaveEth("RPL", "RPL", "0xB76CF92076adBF1D9C39294FA8e7A67579FDe357", "0xD33526068D116cE69F19A9ee46F0bd304F21A51f", 18),
  aaveEth("FXS", "FXS", "0x82F9c5ad306BBa1AD0De49bB5FA6F01bf61085ef", "0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0", 18),
  aaveEth("crvUSD", "crvUSD", "0xb82fa9f31612989525992FCfBB09AB22Eff5c85A", "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E", 18, "CRVUSD"),
  aaveEth("PYUSD", "PYUSD", "0x0C0d01AbF3e6aDfcA0989eBbA9d6e85dD58EaB1E", "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8", 6),
  aaveEth("USDe", "USDe", "0x4F5923Fc5FD4a93352581b38B7cD26943012DECF", "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3", 18),
  aaveEth("cbBTC", "cbBTC", "0x5c647cE0Ae10658ec44FA4E11A51c96e94efd1Dd", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", 8, "CBBTC"),
  aaveEth("tBTC", "tBTC", "0x10Ac93971cdb1F5c778144084242374473c350Da", "0x18084fbA666a33d37592fA2633fD49a74DD93a88", 18),
  aaveEth("EURC", "EURC", "0xAA6e91C82942aeAE040303Bf96c15a6dBcB82CA0", "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", 6),
  aaveBase("WETH", "WETH", "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7", "0x4200000000000000000000000000000000000006", 18, "ETH"),
  aaveBase("wstETH", "wstETH", "0x99CBC45ea5bb7eF3a5BC08FB1B7E56bB2442Ef0D", "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", 18, "STETH"),
  aaveBase("USDC", "USDC", "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6),
  aaveBase("cbBTC", "cbBTC", "0xBdb9300b7CDE636d9cD4AFF00f6F009fFBBc8EE6", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", 8, "CBBTC"),
  aaveBase("GHO", "GHO", "0x067ae75628177FD257c2B1e500993e1a0baBcBd1", "0x6Bb7a212910682DCFdbd5BCBb3e28FB4E8da10Ee", 18),
  aaveBase("tBTC", "tBTC", "0xbcFFB4B3beADc989Bd1458740952aF6EC8fBE431", "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", 18),
  aaveBase("EURC", "EURC", "0x90DA57E0A6C0d166Bf15764E03b83745Dc90025B", "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", 6),
  aaveBase("AAVE", "AAVE", "0x67EAF2BeE4384a2f84Da9Eb8105C661C123736BA", "0x63706e401c06ac8513145b7687A14804d17f814b", 18),
  base("base:aerodrome:weth-usdc-volatile", "aerodrome", "lp", "0xcdac0d6c6c59727a65f871236188350531885c43", "AERO-LP", 18, [
    { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18, isNative: false, chainlinkAssetSymbol: "ETH" },
    { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDC" },
  ], "aerodrome-lp"),
  morphoBase("gtusdcp", "gtUSDCp", "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("steakusdc", "steakUSDC", "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("grovebbqusdc", "grove-bbqUSDC", "0xBeEf2d50B428675a1921bC6bBF4bfb9D8cF1461A", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("frogusdc", "frUSDC", "0x2C6D169782bF18Cc634D076Fe639092227B82fdA", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("steakprimeusdc", "steakPrimeUSDC", "0xBEEFE94c8aD530842bfE7d8B397938fFc1cb83b2", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("pangolinsusdc", "pUSDC", "0x1401d1271C47648AC70cBcdfA3776D4A87CE006B", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("sparkusdc", "sparkUSDC", "0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("bbqusdc", "bbqUSDC", "0xBEEFA7B88064FeEF0cEe02AAeBBd95D30df3878F", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("yearnogusdc", "ymvOG-USDC", "0xef417a2512C5a41f69AE4e021648b69a7CdE5D03", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("gtusdcc", "gtUSDCc", "0xc0c5689e6f4D256E861F65465b691aeEcC0dEb12", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("clearstarusdc", "CSUSDC", "0x1D3b1Cd0a0f242d598834b3F2d126dC6bd774657", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("ousdbv1", "OUSDb-V1", "0x581Cc9a73Ec7431723A4a80699B8f801205841F1", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("seamlessusdc", "smUSDC", "0x616a4E1db48e22028f6bbf20444Cd3b8e3273738", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USDC"),
  morphoBase("steakeurc", "steakEURC", "0xBeEF086b8807Dc5E5A1740C5E3a7C4c366eA6ab5", "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", "EURC", "EURC"),
  morphoBase("yieldclearstarusdc", "YCSUSDC", "0xE74c499fA461AF1844fCa84204490877787cED56", "0x833589fCD6eDb6E08f4C32D4f71b54bdA02913", "USDC", "USDC"),
  moonwellBase("usdc", "mUSDC", "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", 6, "USDC"),
  moonwellBase("eth", "mWETH", "0x628ff693426583D9a7FB391E54366292F509D457", null, "ETH", 18, "ETH", true),
  moonwellBase("wsteth", "mwstETH", "0x627Fe393Bc6EdDA28e99AE648fD6fF362514304b", "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", "wstETH", 18, "STETH"),
  moonwellBase("cbbtc", "mcbBTC", "0xF877ACaFA28c19b96727966690b2f44d35aD5976", "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "cbBTC", 8, "CBBTC"),
  moonwellBase("dai", "mDAI", "0x73b06D8d18De422E269645eaCe15400DE7462417", "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", "DAI", 18, "DAI"),
  moonwellBase("eurc", "mEURC", "0xb682c840B5F4FC58B20769E691A6fa1305A501a2", "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", "EURC", 6, "EURC"),
  moonwellBase("usds", "mUSDS", "0xb6419c6C2e60c4025D6D06eE4F913ce89425a357", "0x820C137fa70C8691f0e44Dc420a5e53c168921Dc", "USDS", 18, "USDS"),
  moonwellBase("tbtc", "mtBTC", "0x9A858ebfF1bEb0D3495BB0e2897c1528eD84A218", "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b", "tBTC", 18, "tBTC"),
  base("base:moonwell-vault:mweth", "moonwell-vaults", "vault", "0x89BeDBB1C4837444Da215A377275Ff96A84D6f53", "mwETH", 18, [{ address: null, symbol: "ETH", decimals: 18, isNative: true, chainlinkAssetSymbol: "ETH" }], "erc4626", "ETH"),
  base("base:moonwell-vault:mwusdc", "moonwell-vaults", "vault", "0x48a90E85be5C56b0A669985A12ee7C449fC79965", "mwUSDC", 18, [{ address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDC" }], "erc4626", "USDC"),
  base("base:moonwell-vault:mweurc", "moonwell-vaults", "vault", "0x5083b1387Ec3d4Ee6467B83890D98f1AF93F7c48", "mwEURC", 18, [{ address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", symbol: "EURC", decimals: 6, isNative: false, chainlinkAssetSymbol: "EURC" }], "erc4626", "EURC"),
  cometBase("USDC", "USDC", "0xb125E6687d4313864e53df431d5425969c15Eb2F", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 6, "USDC"),
  cometBase("WETH", "WETH", "0x46e6b214b524310239732D51387075E0e70970bf", "0x4200000000000000000000000000000000000006", 18, "ETH"),
  cometBase("USDS", "USDS", "0x2c776041CCFe903071AF44aa147368a9c8EEA518", "0x820C137fa70C8691f0e44Dc420a5e53c168921Dc", 18, "USDS"),
]);

export function registryVersion(definitions: readonly DeFiTokenDefinition[]): string {
  const hash = createHash("sha256");
  for (const definition of definitions) hash.update(JSON.stringify(definition) + "\n");
  return `sha256:${hash.digest("hex")}`;
}
