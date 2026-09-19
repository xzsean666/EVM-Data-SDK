import axios from "axios";
import {
  KlineArchiveManager as SdkKlineArchiveManager,
  type KlineArchiveManagerOptions,
} from "token-price-sdk";

export type { KlineArchiveManagerOptions };

export class KlineArchiveManager extends SdkKlineArchiveManager {
  constructor(options: KlineArchiveManagerOptions = {}) {
    super({
      ...options,
      axiosInstance: options.axiosInstance ?? axios,
    });
  }
}
