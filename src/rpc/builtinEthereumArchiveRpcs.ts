/**
 * Built-in unauthenticated public Ethereum Mainnet Archive RPC candidates.
 *
 * This module owns only the static registry of stable ID/URL pairs. It has
 * no network, health, or proxy knowledge — that belongs to
 * `EthereumArchiveRpcPool`/`EthereumArchiveRpcExecutor`. Only the stable
 * `id` may ever appear in errors, observations, or snapshots; the `url`
 * value is treated as secret-shaped even though these are public endpoints,
 * so the same redaction rules as caller-supplied endpoints apply uniformly.
 *
 * Verification snapshot: each URL below successfully answered an Ethereum
 * historical `eth_call` to Multicall3 at block 18,000,000 during a live
 * check on 2026-08-07 (see `docs/INTEGRATIONS.md` section 17 and
 * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md`). This is a
 * point-in-time verification, not an uptime, retention, rate-limit,
 * privacy, or terms guarantee. Update only through
 * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md`'s documented
 * procedure.
 */

export interface BuiltinEthereumArchiveRpcCandidate {
  readonly id: string;
  readonly url: string;
}

export const BUILTIN_ETHEREUM_ARCHIVE_RPCS: readonly BuiltinEthereumArchiveRpcCandidate[] = Object.freeze([
  Object.freeze({ id: "drpc-public", url: "https://eth.drpc.org" }),
  Object.freeze({ id: "blastapi-public", url: "https://eth-mainnet.public.blastapi.io" }),
  Object.freeze({ id: "mevblocker-public", url: "https://rpc.mevblocker.io" }),
  Object.freeze({ id: "nodies-public", url: "https://eth-pokt.nodies.app" }),
  Object.freeze({ id: "tenderly-public", url: "https://mainnet.gateway.tenderly.co" }),
  Object.freeze({ id: "ankr-keyed-1", url: "https://rpc.ankr.com/eth/d63026f400105d4547449739efa9a0e1a1011d5f59fafe16b210eec40d526a82" }),
  Object.freeze({ id: "ankr-keyed-2", url: "https://rpc.ankr.com/eth/9547a67ab80fa87bd55cb5c61c7e9b091d78c35a8310a542a641b3b4112b7af0" }),
]);
