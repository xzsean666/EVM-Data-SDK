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
  Object.freeze({ id: "ankr-keyed-1", url: "https://rpc.ankr.com/base/d63026f400105d4547449739efa9a0e1a1011d5f59fafe16b210eec40d526a82" }),
  Object.freeze({ id: "ankr-keyed-2", url: "https://rpc.ankr.com/base/9547a67ab80fa87bd55cb5c61c7e9b091d78c35a8310a542a641b3b4112b7af0" }),
]);
