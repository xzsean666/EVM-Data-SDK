import { EtherscanAdapter, type EtherscanAdapterOptions } from "../etherscan/EtherscanAdapter";
import type { ProviderAttemptContext } from "../DataProviderAdapter";
import type { Erc20TokenHoldings } from "../../domain/models";

/**
 * Blockscout's explorer API exposes the Etherscan-compatible account module.
 * The shared adapter keeps request, pagination, mapping, and error contracts
 * identical while this class supplies the provider identity and route kind.
 */
export class BlockscoutAdapter extends EtherscanAdapter {
  constructor(options: Omit<EtherscanAdapterOptions, "providerName" | "routeName"> = {}) {
    super({ ...options, providerName: "blockscout", routeName: "blockscout" });
  }

  protected override normalizeResponse(action: string, body: unknown): unknown {
    if (action !== "txlistinternal" || body === null || typeof body !== "object") return body;
    const envelope = body as { result?: unknown };
    if (!Array.isArray(envelope.result)) return body;
    return {
      ...envelope,
      result: envelope.result.map((item) => {
        if (item === null || typeof item !== "object") return item;
        const row = item as { hash?: unknown; transactionHash?: unknown };
        return row.hash !== undefined || typeof row.transactionHash !== "string"
          ? item
          : { ...row, hash: row.transactionHash };
      }),
    };
  }

  override async getErc20TokenHoldings(
    request: { readonly address: string },
    context: ProviderAttemptContext,
  ): Promise<Erc20TokenHoldings> {
    const root = this.endpointFor(context.chain).replace(/\/api\/?$/, "");
    const body = await this.requestRaw(
      `${root}/api/v2/addresses/${request.address}/token-balances`,
      {},
      context,
    );
    if (!Array.isArray(body)) {
      throw new Error("Blockscout token holdings response was malformed.");
    }
    const items = body.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") return [];
      const row = entry as { token?: Record<string, unknown>; value?: unknown };
      const token = row.token;
      if (token === undefined || typeof token.address_hash !== "string" || typeof row.value !== "string") return [];
      return [{
        chainId: context.chain.chainId,
        address: request.address,
        tokenAddress: token.address_hash,
        tokenName: typeof token.name === "string" ? token.name : null,
        tokenSymbol: typeof token.symbol === "string" ? token.symbol : null,
        tokenDecimals: typeof token.decimals === "string" && /^\d+$/.test(token.decimals) ? Number(token.decimals) : null,
        amount: row.value,
        provider: this.name,
      }];
    });
    return { chainId: context.chain.chainId, address: request.address, items, provider: this.name, pages: 1, upstreamRequests: 1 };
  }
}
