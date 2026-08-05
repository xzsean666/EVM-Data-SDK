export const etherscanTransactionsSuccess = {
  status: "1",
  message: "OK",
  result: [
    {
      blockNumber: "00000123",
      timeStamp: "1700000000",
      hash: "0xABCDEF",
      nonce: "00000002",
      blockHash: "0xBEEF",
      transactionIndex: "00000001",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "0001000",
      gas: "21000",
      gasUsed: "21000",
      gasPrice: "1000000000",
      input: "0x",
      isError: "0",
      txreceipt_status: "1",
      extraFutureField: "ignored",
    },
  ],
};

export const etherscanTransactionsEmpty = {
  status: "0",
  message: "No transactions found",
  result: [],
};

export const etherscanTransactionsVariants = {
  status: "1",
  message: "OK",
  result: [
    {
      blockNumber: "7",
      hash: "0xCAFE",
      from: "0x1111111111111111111111111111111111111111",
      to: "",
      value: "0",
      isError: "1",
      txreceipt_status: "0",
    },
    {
      blockNumber: "8",
      hash: "0xD00D",
      from: "0x1111111111111111111111111111111111111111",
      to: null,
      value: "0",
    },
  ],
};

export const etherscanTokenTransfersSuccess = {
  status: "1",
  message: "OK",
  result: [
    {
      blockNumber: "42",
      timeStamp: "1700000001",
      hash: "0xAAA",
      transactionHash: "0xAAA",
      logIndex: "0003",
      from: "0x3333333333333333333333333333333333333333",
      to: "0x4444444444444444444444444444444444444444",
      contractAddress: "0x5555555555555555555555555555555555555555",
      value: "00000099",
      tokenName: "Token",
      tokenSymbol: "TOK",
      tokenDecimal: "018",
    },
  ],
};

export const etherscanBalanceSuccess = {
  status: "1",
  message: "OK",
  result: "000123",
};

export const etherscanInvalidKey = {
  status: "0",
  message: "NOTOK",
  result: "Invalid API Key",
};

export const etherscanPlanRestricted = {
  status: "0",
  message: "NOTOK",
  result: "Free API access is not supported for this chain",
};

export const etherscanRateLimited = {
  status: "0",
  message: "NOTOK",
  result: "Max rate limit reached",
};

export const etherscanUnsupportedChain = {
  status: "0",
  message: "NOTOK",
  result: "Error! Missing or unsupported chainid parameter (56)",
};
