import type { StorageAdapter } from "./StorageAdapter";
import type { TokenSupportRecord, TokenSupportProvider } from "../domain/tokenSupportModels";

export class TokenSupportStore {
  constructor(private readonly storage: StorageAdapter) {}

  async loadAll(): Promise<readonly TokenSupportRecord[]> {
    try {
      const rows = await this.storage.all<{
        token: string;
        provider: string;
        supported: number | string;
        updated_at: string;
      }>("SELECT token, provider, supported, updated_at FROM sdk_token_support");
      return rows.map((row) => ({
        token: row.token,
        provider: row.provider as TokenSupportProvider,
        supported: Number(row.supported) === 1,
        updatedAt: row.updated_at,
      }));
    } catch {
      return [];
    }
  }

  async get(token: string, provider: TokenSupportProvider): Promise<TokenSupportRecord | null> {
    try {
      const row = await this.storage.get<{
        token: string;
        provider: string;
        supported: number | string;
        updated_at: string;
      }>("SELECT token, provider, supported, updated_at FROM sdk_token_support WHERE token = ? AND provider = ?", [
        token.toUpperCase(),
        provider,
      ]);
      if (!row) return null;
      return {
        token: row.token,
        provider: row.provider as TokenSupportProvider,
        supported: Number(row.supported) === 1,
        updatedAt: row.updated_at,
      };
    } catch {
      return null;
    }
  }

  set(token: string, provider: TokenSupportProvider, supported: boolean): void {
    const sql = `INSERT OR REPLACE INTO sdk_token_support (token, provider, supported, updated_at) VALUES (?, ?, ?, ?)`;
    const values = [
      token.toUpperCase(),
      provider,
      supported ? 1 : 0,
      new Date().toISOString(),
    ];
    try {
      const res = this.storage.run(sql, values);
      if (res && typeof (res as Promise<unknown>).catch === "function") {
        (res as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      // Storage might not be initialized yet; ignore safely
    }
  }
}
