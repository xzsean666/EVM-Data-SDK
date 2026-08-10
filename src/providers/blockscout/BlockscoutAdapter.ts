import { EtherscanAdapter, type EtherscanAdapterOptions } from "../etherscan/EtherscanAdapter";

/**
 * Blockscout's explorer API exposes the Etherscan-compatible account module.
 * The shared adapter keeps request, pagination, mapping, and error contracts
 * identical while this class supplies the provider identity and route kind.
 */
export class BlockscoutAdapter extends EtherscanAdapter {
  constructor(options: Omit<EtherscanAdapterOptions, "providerName" | "routeName"> = {}) {
    super({ ...options, providerName: "blockscout", routeName: "blockscout" });
  }
}

