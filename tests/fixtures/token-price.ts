const dayMilliseconds = Date.UTC(2026, 6, 1);
const daySeconds = dayMilliseconds / 1_000;

export const tokenPriceFixtureDay = "2026-07-01";

export const binanceEthUsdtExchangeInfo = {
  symbols: [{ symbol: "ETHUSDT", status: "TRADING", isSpotTradingAllowed: true }],
};

export const binanceEthUsdtDailyKlines = [
  [dayMilliseconds, "1", "2", "0.5", "1.5", "100"],
];

export const okxEthUsdtSpotInstruments = {
  code: "0",
  data: [
    { instId: "ETH-USDT", instType: "SPOT", state: "live" },
    { instId: "ETH-USDT-SWAP", instType: "SWAP", state: "live" },
  ],
};

export const okxEthUsdtDailyCandles = {
  code: "0",
  data: [[String(dayMilliseconds), "1", "2", "0.5", "1.5", "100", "0", "0", "1"]],
};

export const coinbaseEthUsdProducts = [
  { id: "ETH-USD", status: "online", trading_disabled: false },
];

export const coinbaseEthUsdDailyCandles = [
  [daySeconds, "0.5", "2", "1", "1.5", "100"],
];

export const geckoEthSearchPools = {
  data: [{
    id: "eth_0x2222222222222222222222222222222222222222",
    type: "pool",
    attributes: {
      address: "0x2222222222222222222222222222222222222222",
      reserve_in_usd: "1000",
      volume_usd: { h24: "10" },
    },
    relationships: {
      network: { data: { id: "eth", type: "network" } },
      base_token: { data: { id: "eth_0x1111111111111111111111111111111111111111", type: "token" } },
      quote_token: { data: null },
    },
  }],
  included: [{
    id: "eth_0x1111111111111111111111111111111111111111",
    type: "token",
    attributes: { address: "0x1111111111111111111111111111111111111111", symbol: "ETH", name: "Ethereum" },
  }],
};

export const geckoEthUsdDailyOhlcv = {
  data: { attributes: { ohlcv_list: [[daySeconds, "1", "2", "0.5", "1.5", "100"]] } },
};
