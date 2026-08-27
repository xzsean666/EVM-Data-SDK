import { describe, expect, it } from "vitest";
import { EnvLoader, parseEnvContent, loadClientConfigurationFromEnv } from "../../src/env/EnvLoader";
import { parseClientConfiguration } from "../../src/domain/configuration";
import { EvmDataClient } from "../../src/client/EvmDataClient";

describe("EnvLoader & Env Management", () => {
  describe("parseEnvContent", () => {
    it("parses plain, double-quoted, and single-quoted values", () => {
      const content = `
        # Comment line
        KEY1=plain_value
        KEY2="double_quoted_value"
        KEY3='single_quoted_value'
        EMPTY_KEY=
        SPACED_KEY = spaced value 
      `;
      const result = parseEnvContent(content);
      expect(result).toEqual({
        KEY1: "plain_value",
        KEY2: "double_quoted_value",
        KEY3: "single_quoted_value",
        EMPTY_KEY: "",
        SPACED_KEY: "spaced value",
      });
    });
  });

  describe("NodeReal MegaNode Multi-Chain RPC Parsing", () => {
    it("extracts multiple NodeReal keys and generates endpoints across all supported chains", () => {
      const content = `
        NODEREAL_RPC_API_KEY1=key_nodereal_one
        NODEREAL_RPC_API_KEY2=key_nodereal_two
      `;
      const loader = new EnvLoader({ content, fallbackToProcessEnv: false });

      const ethEndpoints = loader.getRpcEndpoints("ethereum");
      expect(ethEndpoints).toHaveLength(2);
      expect(ethEndpoints[0]).toEqual({
        id: "nodereal-ethereum-1",
        url: "https://eth-mainnet.nodereal.io/v1/key_nodereal_one",
        enabled: true,
      });
      expect(ethEndpoints[1]).toEqual({
        id: "nodereal-ethereum-2",
        url: "https://eth-mainnet.nodereal.io/v1/key_nodereal_two",
        enabled: true,
      });

      const baseEndpoints = loader.getRpcEndpoints("base");
      expect(baseEndpoints).toHaveLength(2);
      expect(baseEndpoints[0]).toEqual({
        id: "nodereal-base-1",
        url: "https://open-platform.nodereal.io/key_nodereal_one/base",
        enabled: true,
      });
      expect(baseEndpoints[1]).toEqual({
        id: "nodereal-base-2",
        url: "https://open-platform.nodereal.io/key_nodereal_two/base",
        enabled: true,
      });

      const bscEndpoints = loader.getRpcEndpoints("bsc");
      expect(bscEndpoints).toHaveLength(2);
      expect(bscEndpoints[0]?.url).toBe("https://bsc-mainnet.nodereal.io/v1/key_nodereal_one");

      const polyEndpoints = loader.getRpcEndpoints("polygon");
      expect(polyEndpoints).toHaveLength(2);
      expect(polyEndpoints[0]?.url).toBe("https://polygon-mainnet.nodereal.io/v1/key_nodereal_one");

      const arbEndpoints = loader.getRpcEndpoints("arbitrum");
      expect(arbEndpoints).toHaveLength(2);
      expect(arbEndpoints[0]?.url).toBe("https://open-platform.nodereal.io/key_nodereal_one/arbitrum-nitro/");

      const optEndpoints = loader.getRpcEndpoints("optimism");
      expect(optEndpoints).toHaveLength(2);
      expect(optEndpoints[0]?.url).toBe("https://opt-mainnet.nodereal.io/v1/key_nodereal_one");

      // Verify endpoint IDs do NOT contain the secret key (redaction safety)
      for (const ep of ethEndpoints) {
        expect(ep.id).not.toContain("key_nodereal");
      }
    });

    it("handles NODEREAL_API_KEY and MEGANODE_API_KEY variants", () => {
      const content = `
        NODEREAL_API_KEY=key_nodereal_single
        MEGANODE_API_KEY=key_meganode_single
      `;
      const loader = new EnvLoader({ content, fallbackToProcessEnv: false });
      const ethEndpoints = loader.getRpcEndpoints("ethereum");
      expect(ethEndpoints).toHaveLength(2);
    });
  });

  describe("Ankr, Alchemy, DRPC, Infura, and Direct RPC Endpoints", () => {
    it("extracts Ankr multi-chain keys", () => {
      const content = "ANKR_RPC_API_KEY1=key_ankr_1";
      const loader = new EnvLoader({ content, fallbackToProcessEnv: false });

      expect(loader.getRpcEndpoints("ethereum")[0]).toEqual({
        id: "ankr-ethereum-1",
        url: "https://rpc.ankr.com/eth/key_ankr_1",
        enabled: true,
      });
      expect(loader.getRpcEndpoints("base")[0]).toEqual({
        id: "ankr-base-1",
        url: "https://rpc.ankr.com/base/key_ankr_1",
        enabled: true,
      });
    });

    it("extracts Alchemy multi-chain keys", () => {
      const content = "ALCHEMY_RPC_API_KEY1=key_alchemy_1";
      const loader = new EnvLoader({ content, fallbackToProcessEnv: false });

      expect(loader.getRpcEndpoints("ethereum")[0]).toEqual({
        id: "alchemy-ethereum-1",
        url: "https://eth-mainnet.g.alchemy.com/v2/key_alchemy_1",
        enabled: true,
      });
      expect(loader.getRpcEndpoints("base")[0]).toEqual({
        id: "alchemy-base-1",
        url: "https://base-mainnet.g.alchemy.com/v2/key_alchemy_1",
        enabled: true,
      });
    });

    it("extracts DRPC and Infura multi-chain keys", () => {
      const content = `
        DRPC_RPC_API_KEY1=key_drpc_1
        INFURA_RPC_API_KEY1=key_infura_1
      `;
      const loader = new EnvLoader({ content, fallbackToProcessEnv: false });

      const eth = loader.getRpcEndpoints("ethereum");
      expect(eth.some((e) => e.id === "drpc-ethereum-1")).toBe(true);
      expect(eth.some((e) => e.id === "infura-ethereum-1")).toBe(true);
    });

    it("extracts direct custom RPC URLs", () => {
      const content = `
        ETHEREUM_RPC_URL1=https://custom-eth-archive.example.com
        BASE_RPC_URL1=https://custom-base-archive.example.com
      `;
      const loader = new EnvLoader({ content, fallbackToProcessEnv: false });

      expect(loader.getRpcEndpoints("ethereum")[0]).toEqual({
        id: "custom-ethereum-1",
        url: "https://custom-eth-archive.example.com",
        enabled: true,
      });
      expect(loader.getRpcEndpoints("base")[0]).toEqual({
        id: "custom-base-1",
        url: "https://custom-base-archive.example.com",
        enabled: true,
      });
    });
  });

  describe("Indexed Data Provider Key Pools", () => {
    it("extracts Etherscan, Blockscout, Alchemy, and Moralis keys", () => {
      const content = `
        ETHERSCAN_API_KEY1=etherscan_k1
        ETHERSCAN_API_KEY2=etherscan_k2
        BLOCKSCOUT_API_KEY=blockscout_k1
        ALCHEMY_API_KEY=alchemy_k1
        MORALIS_API_KEY=moralis_k1
      `;
      const loader = new EnvLoader({ content, fallbackToProcessEnv: false });
      const configs = loader.getProviderConfigs();

      expect(configs).toHaveLength(4);
      const etherscan = configs.find((c) => c.kind === "etherscan");
      expect(etherscan?.apiKeys).toEqual(["etherscan_k1", "etherscan_k2"]);

      const blockscout = configs.find((c) => c.kind === "blockscout");
      expect(blockscout?.apiKeys).toEqual(["blockscout_k1"]);
    });
  });

  describe("Proxy and Storage Environment Settings", () => {
    it("extracts proxies and storage URL", () => {
      const content = `
        HTTP_PROXY=http://127.0.0.1:8080
        PROXY_URL1=http://127.0.0.1:8081
        SING_BOX_URL=http://127.0.0.1:9090
        DATABASE_URL=postgres://user:pass@localhost:5432/evmdb
      `;
      const loader = new EnvLoader({ content, fallbackToProcessEnv: false });

      expect(loader.getProxies()).toHaveLength(2);
      expect(loader.getSingBoxUrls()).toEqual(["http://127.0.0.1:9090"]);
      expect(loader.getStorageUrl()).toBe("postgres://user:pass@localhost:5432/evmdb");
    });
  });

  describe("ClientConfiguration Integration & SDK Direct Env Passing", () => {
    it("auto-injects multi-chain RPC endpoints into Chainlink, DeFi, and Uniswap services via envContent", () => {
      const envContent = `
        NODEREAL_RPC_API_KEY1=test_nodereal_key
        ANKR_RPC_API_KEY1=test_ankr_key
        ETHERSCAN_API_KEY1=test_etherscan_key
      `;

      const normalized = parseClientConfiguration({
        envContent,
        chainlink: { enabled: true },
        defi: { enabled: true },
        uniswapV3: { enabled: true },
      });

      // Chainlink should have received both NodeReal and Ankr Ethereum endpoints
      expect(normalized.chainlink.rpcEndpoints.length).toBeGreaterThanOrEqual(2);
      expect(normalized.chainlink.rpcEndpoints.some((e) => e.id === "nodereal-ethereum-1")).toBe(true);
      expect(normalized.chainlink.rpcEndpoints.some((e) => e.id === "ankr-ethereum-1")).toBe(true);

      // DeFi should have received Ethereum and Base endpoints
      expect(normalized.defi.rpcEndpoints.ethereum.some((e) => e.id === "nodereal-ethereum-1")).toBe(true);
      expect(normalized.defi.rpcEndpoints.base.some((e) => e.id === "nodereal-base-1")).toBe(true);

      // Uniswap V3 should have received Ethereum endpoints
      expect(normalized.uniswapV3.rpcEndpoints.some((e) => e.id === "nodereal-ethereum-1")).toBe(true);

      // Etherscan provider should be registered
      expect(normalized.providers.some((p) => p.kind === "etherscan")).toBe(true);
    });

    it("instantiates EvmDataClient directly with envContent", () => {
      const envContent = `
        NODEREAL_RPC_API_KEY1=test_key_nodereal
        ETHERSCAN_API_KEY1=test_key_etherscan
      `;

      const client = new EvmDataClient({
        envContent,
        price: {
          providers: [{ kind: "binance" }],
        },
      });

      expect(client).toBeDefined();
      expect(client.address).toBeDefined();
      expect(client.token).toBeDefined();
    });

    it("allows loading via loadClientConfigurationFromEnv helper", () => {
      const content = `
        ETHERSCAN_API_KEY=my_etherscan_key
        NODEREAL_RPC_API_KEY1=my_nodereal_key
      `;
      const config = loadClientConfigurationFromEnv({
        content,
        fallbackToProcessEnv: false,
        overrides: {
          chainlink: { enabled: true },
        },
      });

      expect(config.providers).toBeDefined();
      expect(config.chainlink?.rpcEndpoints).toBeDefined();
      expect(config.chainlink?.rpcEndpoints?.some((e) => e.id === "nodereal-ethereum-1")).toBe(true);
    });
  });
});
