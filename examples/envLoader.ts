import fs from "node:fs";
import path from "node:path";

export interface EnvLoaderOptions {
  /**
   * Path to the environment file (e.g. .env, .env.key).
   * Defaults to '.env.key' or '.env' in current working directory.
   */
  filePath?: string;
  /**
   * Raw text content of environment variables.
   * If provided, overrides filePath reading.
   */
  content?: string;
}

/**
 * Parses raw .env file text into Key-Value pairs.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    let val = trimmed.substring(eqIdx + 1).trim();

    // Remove quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }

    if (key) {
      result[key] = val;
    }
  }

  return result;
}

export class EnvLoader {
  private envMap: Record<string, string> = {};

  constructor(options: EnvLoaderOptions = {}) {
    if (options.content !== undefined) {
      this.envMap = parseEnvContent(options.content);
    } else {
      const targetPath = options.filePath ?? this.findDefaultEnvFile();
      if (targetPath && fs.existsSync(targetPath)) {
        const fileContent = fs.readFileSync(targetPath, "utf-8");
        this.envMap = parseEnvContent(fileContent);
      }
    }
  }

  /**
   * Find default env file (.env.key or .env) searching current and parent directories.
   */
  private findDefaultEnvFile(): string | undefined {
    let currentDir = process.cwd();
    while (true) {
      const keyPath = path.join(currentDir, ".env.key");
      if (fs.existsSync(keyPath)) return keyPath;

      const envPath = path.join(currentDir, ".env");
      if (fs.existsSync(envPath)) return envPath;

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
    return undefined;
  }

  /**
   * Get all environment keys matching a specific prefix (e.g. "ETHERSCAN_API_KEY", "ALCHEMY_API_KEY").
   * Supports custom filtering or sorting if needed.
   */
  getKeysByPrefix(prefix: string): string[] {
    const uppercasePrefix = prefix.toUpperCase();
    const keys: string[] = [];

    // First collect matching keys sorted by suffix/key name
    const sortedEntries = Object.entries(this.envMap)
      .filter(([k]) => k.toUpperCase().startsWith(uppercasePrefix))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    for (const [_, val] of sortedEntries) {
      if (val && !keys.includes(val)) {
        keys.push(val);
      }
    }

    // Fallback to process.env if none found in env file
    if (keys.length === 0) {
      const processEntries = Object.entries(process.env)
        .filter(([k, v]) => k.toUpperCase().startsWith(uppercasePrefix) && !!v)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

      for (const [_, val] of processEntries) {
        if (val && !keys.includes(val)) {
          keys.push(val!);
        }
      }
    }

    return keys;
  }

  /**
   * Dynamically build SDK provider configurations based on prefix mapping.
   */
  getProviderConfig(kind: "etherscan" | "alchemy" | "moralis", prefix?: string) {
    const defaultPrefixMap: Record<string, string> = {
      etherscan: "ETHERSCAN_API_KEY",
      alchemy: "ALCHEMY_API_KEY",
      moralis: "MORALIS_API_KEY",
    };

    const targetPrefix = prefix ?? defaultPrefixMap[kind];
    const apiKeys = this.getKeysByPrefix(targetPrefix);

    return {
      kind,
      apiKeys,
    };
  }
}
