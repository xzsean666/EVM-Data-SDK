/**
 * Public Base Mainnet Archive RPC candidates. These are direct-only and are
 * health-probed during client initialization; IDs, rather than URLs, are the
 * only endpoint identifier exposed by the SDK.
 */
export interface BuiltinBaseArchiveRpcCandidate {
  readonly id: string;
  readonly url: string;
}

export const BUILTIN_BASE_ARCHIVE_RPCS: readonly BuiltinBaseArchiveRpcCandidate[] = Object.freeze([
  Object.freeze({ id: "base-drpc", url: "https://base.drpc.org" }),
  Object.freeze({ id: "base-blastapi", url: "https://base-mainnet.public.blastapi.io" }),
  Object.freeze({ id: "base-meowrpc", url: "https://base.meowrpc.com" }),
  Object.freeze({ id: "base-publicnode", url: "https://base-rpc.publicnode.com" }),
  Object.freeze({ id: "base-llamarpc", url: "https://base.llamarpc.com" }),
  Object.freeze({ id: "base-1rpc", url: "https://1rpc.io/base" }),
]);
