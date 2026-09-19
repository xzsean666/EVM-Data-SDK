# EVM Data SDK 模块化示例指南 (Examples Guide)

本项目的所有示例均已按功能模块**独立拆分**，每个模块一个专属文件，结构清晰，可直接独立运行与排查。

---

## 📁 示例目录结构

| 文件名 | 对应核心模块 | 核心功能演示 |
| :--- | :--- | :--- |
| [`01_env_and_client_init.ts`](file:///ssd0/git/EVM-Data-SDK/examples/01_env_and_client_init.ts) | `EnvLoader`, `EvmDataClient` | 配置文件解析、多链 Archive RPC 节点池、索引商 Key 池生成、客户端初始化与生命周期 |
| [`02_address_and_transactions.ts`](file:///ssd0/git/EVM-Data-SDK/examples/02_address_and_transactions.ts) | `client.address` (`AddressService`) | 原生币余额查询、普通交易分页拉取 (游标 cursor)、闭区间区块范围交易扫描与流式 `onWindow` |
| [`03_token_transfers_and_holdings.ts`](file:///ssd0/git/EVM-Data-SDK/examples/03_token_transfers_and_holdings.ts) | `client.token` (`TokenService`) | ERC-20 转账历史 (入账/出账)、区块范围代币扫描、历史特定代币余额、当前与历史全量代币持仓发现 |
| [`04_token_prices_and_klines.ts`](file:///ssd0/git/EVM-Data-SDK/examples/04_token_prices_and_klines.ts) | `client.token`, `client.price` | 多源现货价格聚合 (Binance/OKX/Coinbase/Gecko)、中位数与离群值剔除、Binance/Gate 高精度 K 线 |
| [`05_archive_rpc_multicall.ts`](file:///ssd0/git/EVM-Data-SDK/examples/05_archive_rpc_multicall.ts) | `client.rpc`, `client.token` | 纯 RPC 二分法区块时间戳定位 (无需 API Key)、历史精确区块余额、ERC-20 批量 Multicall3、通用 JSON-RPC Batch |
| [`06_chainlink_oracles.ts`](file:///ssd0/git/EVM-Data-SDK/examples/06_chainlink_oracles.ts) | `client.chainlink` (`ChainlinkService`) | Ethereum 主网 Chainlink 预言机全量喂价读取、定点数精度自适应、部分成功容错与失败隔离 |
| [`07_defi_exchange_rates.ts`](file:///ssd0/git/EVM-Data-SDK/examples/07_defi_exchange_rates.ts) | `client.defi` (`DeFiExchangeRateService`) | DeFi 收益代币底层资产兑换率快照 (Compound cTokens, Aave aTokens, Lido wstETH/stETH, Maker sDAI) |
| [`08_uniswap_historical_prices.ts`](file:///ssd0/git/EVM-Data-SDK/examples/08_uniswap_historical_prices.ts) | `client.uniswapV3`, `client.uniswapV4` | Uniswap V3 slot0 (sqrtPriceX96/tick) 现货与 Tick 价格计算、Uniswap V4 StateView 历史价格读取 |
| [`09_chain_metadata_and_internal_txs.ts`](file:///ssd0/git/EVM-Data-SDK/examples/09_chain_metadata_and_internal_txs.ts) | `client.chain` (`ApiChainService`) | 浏览器 API 区块与时间戳定位、交易详情与 Receipt 批量查询、内部交易 (Traces) 扫描、以太坊信标链提款扫描 |
| [`10_data_sync_and_history.ts`](file:///ssd0/git/EVM-Data-SDK/examples/10_data_sync_and_history.ts) | `client.sync`, `client.history` | 增量数据同步入库 (SQLite/Postgres)、分叉回滚保护、历史状态账本重放 (任意区块余额重构)、本地流水检索 |
| [`11_alerts_and_cooldowns.ts`](file:///ssd0/git/EVM-Data-SDK/examples/11_alerts_and_cooldowns.ts) | `client.alert`, `CooldownTracker` | 被动故障熔断与指数阶梯冷却 (1s->5s->15s...)、跨进程持久化恢复、Slack Webhook 故障卡片告警 |
| [`common.ts`](file:///ssd0/git/EVM-Data-SDK/examples/common.ts) | 通用辅助 | 自动定位 `.env.key`、统一客户端构建工厂、常用测试地址与打印工具 |
| [`demo.ts`](file:///ssd0/git/EVM-Data-SDK/examples/demo.ts) | 综合串联演示 | 一键式综合功能快速巡检脚本 |

---

## 🚀 运行方法

在项目根目录下直接使用 `node` 运行任意模块示例即可：

```bash
# 1. 环境变量解析与客户端初始化
node examples/01_env_and_client_init.ts

# 2. 地址原生币余额与交易查询
node examples/02_address_and_transactions.ts

# 3. ERC-20 代币转账与钱包持仓
node examples/03_token_transfers_and_holdings.ts

# 4. 代币现货聚合价格与 K 线
node examples/04_token_prices_and_klines.ts

# 5. 归档 RPC、Multicall3 与 JSON-RPC Batch
node examples/05_archive_rpc_multicall.ts

# 6. Chainlink 链上预言机历史价格
node examples/06_chainlink_oracles.ts

# 7. DeFi 协议代币底层兑换率 (Compound/Aave/Lido/Maker)
node examples/07_defi_exchange_rates.ts

# 8. Uniswap V3 & V4 历史池子价格
node examples/08_uniswap_historical_prices.ts

# 9. 浏览器元数据与内部交易扫描
node examples/09_chain_metadata_and_internal_txs.ts

# 10. 增量数据同步与历史状态重放
node examples/10_data_sync_and_history.ts

# 11. 告警上报与节点冷却管理
node examples/11_alerts_and_cooldowns.ts
```

---

## ⚙️ 配置文件准备 (.env.key)

在项目根目录下创建 `.env.key` (或参考 [`.env.example`](file:///ssd0/git/EVM-Data-SDK/.env.example))，按需填入你的 API Key：

```env
# 1. 多链 Archive RPC 密钥 (单个 Key 即可自动为多条链注册对应节点)
NODEREAL_RPC_API_KEY1=your_nodereal_api_key
ALCHEMY_RPC_API_KEY1=your_alchemy_rpc_key
ANKR_RPC_API_KEY1=your_ankr_api_key
DRPC_RPC_API_KEY1=your_drpc_api_key

# 2. 区块浏览器与数据索引商 API Key (支持多 Key 轮询)
ETHERSCAN_API_KEY1=your_etherscan_api_key
BLOCKSCOUT_API_KEY1=your_blockscout_api_key
ALCHEMY_API_KEY1=your_alchemy_api_key
MORALIS_API_KEY1=your_moralis_api_key

# 3. 代理设置 (可选，支持 HTTP/HTTPS 代理)
HTTP_PROXY=http://127.0.0.1:8080

# 4. 本地持久化数据库 (可选，默认使用 sqlite:./data/evm-data-sdk.db)
DATABASE_URL=sqlite:./data/evm-data-sdk.db

# 5. Slack 告警 Webhook (可选)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

> **注意**: 如果没有配置某个第三方的 API Key，示例会自动进行友好提示并跳过该功能，不会导致程序崩溃。
