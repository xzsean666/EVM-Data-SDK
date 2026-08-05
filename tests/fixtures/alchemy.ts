export const alchemyBalanceSuccess = {
  jsonrpc: "2.0",
  id: 1,
  result: "0x1e240",
};

export const alchemyTransfersPage = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    transfers: [
      {
        category: "erc20",
        asset: "TOK",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        hash: "0xABC",
        blockNum: "0x2a",
        rawContract: {
          address: "0x5555555555555555555555555555555555555555",
          decimals: 18,
          value: "0x63",
        },
        metadata: { blockTimestamp: "2024-01-02T03:04:05.000Z" },
        ignored: true,
      },
    ],
    pageKey: "alchemy-page-key-2",
  },
};

export const alchemyTransfersLastPage = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    transfers: [],
    pageKey: null,
  },
};

export const alchemyRpcRateLimited = {
  jsonrpc: "2.0",
  id: 1,
  error: { code: -32002, message: "Request rate limit exceeded" },
};

export const alchemyRpcInvalidParams = {
  jsonrpc: "2.0",
  id: 1,
  error: { code: -32602, message: "invalid argument 0" },
};
