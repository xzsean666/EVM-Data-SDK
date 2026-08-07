export const moralisTransactionsPage = {
  cursor: "moralis-provider-cursor-page-2",
  page: 1,
  page_size: 1,
  result: [
    {
      hash: "0xABCDEF",
      nonce: "00000002",
      transaction_index: "00000001",
      from_address: "0x1111111111111111111111111111111111111111",
      to_address: "0x2222222222222222222222222222222222222222",
      value: "0001000",
      gas: "21000",
      gas_price: "1000000000",
      input: "0x",
      receipt_gas_used: "21000",
      receipt_status: "1",
      block_timestamp: "2024-01-02T03:04:05.000Z",
      block_number: "00000123",
      block_hash: "0xBEEF",
      additional_field: "ignored",
    },
  ],
};

export const moralisTransactionsLastPage = {
  cursor: null,
  page: 2,
  page_size: 1,
  result: [
    {
      hash: "0xCAFE",
      from_address: "0x1111111111111111111111111111111111111111",
      to_address: "",
      value: "0",
      receipt_status: "0",
      block_number: "124",
    },
    {
      hash: "0xD00D",
      from_address: "0x1111111111111111111111111111111111111111",
      to_address: null,
      value: "0",
      block_number: "125",
    },
  ],
};

export const moralisBalance = {
  balance: "000123",
  balance_formatted: "0.000000000000000123",
};

export const moralisErc20Balances = [
  {
    token_address: "0x5555555555555555555555555555555555555555",
    balance: "000123456",
    decimals: "6",
    name: "Fixture Token",
    symbol: "FIX",
  },
];

export const moralisTokenTransfers = {
  cursor: "moralis-token-cursor-page-2",
  page: 1,
  page_size: 2,
  result: [
    {
      token_name: "Token",
      token_symbol: "TOK",
      token_decimals: "018",
      transaction_hash: "0xAAA",
      address: "0x5555555555555555555555555555555555555555",
      block_timestamp: "2024-01-02T03:04:06.000Z",
      block_number: "00042",
      block_hash: "0xBEEF",
      from_address: "0x3333333333333333333333333333333333333333",
      to_address: "0x4444444444444444444444444444444444444444",
      value: "00000099",
      transaction_index: 2,
      log_index: 3,
      possible_spam: false,
      verified_contract: true,
      extra_enriched_field: "ignored",
    },
    {
      token_name: null,
      token_symbol: "",
      transaction_hash: "0xBBB",
      address: "0x5555555555555555555555555555555555555555",
      block_number: "43",
      from_address: "0x4444444444444444444444444444444444444444",
      to_address: "0x3333333333333333333333333333333333333333",
      value: "1",
    },
  ],
};

export const moralisUnsupportedChain = { message: "Unsupported chain provided" };
export const moralisValidationFailure = { message: "Invalid request parameters" };
export const moralisRateLimited = { message: "Too many requests" };
