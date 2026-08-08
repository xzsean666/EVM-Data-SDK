import type { ChainlinkFeedDefinition } from "../src/chainlink/ChainlinkFeedDefinition";

/**
 * Type declarations for `chainlinkFeedSelection.mjs` so deterministic
 * TypeScript tests can import the pure selection/validation/rendering logic
 * with full type checking. The runtime implementation lives in the sibling
 * `.mjs` file; this file only describes its shape.
 */

export function isStandardEthereumCryptoUsdRefPriceFeed(entry: unknown): boolean;

export function buildFeedDefinition(entry: unknown): ChainlinkFeedDefinition;

export function selectAndBuildFeeds(rawEntries: unknown): readonly ChainlinkFeedDefinition[];

export interface RenderGeneratedManifestMetadata {
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly sourceSha256: string;
}

export function renderGeneratedManifest(
  feeds: readonly ChainlinkFeedDefinition[],
  metadata: RenderGeneratedManifestMetadata,
): string;
