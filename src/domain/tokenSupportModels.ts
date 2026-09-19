export type TokenSupportProvider = "binance" | "gate";

export interface TokenSupportRecord {
  readonly token: string;
  readonly provider: TokenSupportProvider;
  readonly supported: boolean;
  readonly updatedAt: string;
}

export type TokenSupportStatusMap = Record<TokenSupportProvider, boolean>;
