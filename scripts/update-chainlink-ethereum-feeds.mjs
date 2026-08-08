/**
 * Manual maintainer command that regenerates
 * `src/chainlink/ethereumMainnetPriceFeeds.generated.ts` from Chainlink's
 * official Ethereum Mainnet feed metadata.
 *
 * This is the ONLY supported way to refresh the manifest. Runtime SDK code
 * never fetches this URL or runs this script. See
 * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md` section 6.2 and
 * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md` section 7.
 *
 * Usage:
 *   pnpm update:chainlink-feeds
 *
 * All selection/validation/rendering logic lives in the pure, network-free
 * `chainlinkFeedSelection.mjs` module so it can be exercised by deterministic
 * tests; this file owns only fetch + filesystem + CLI reporting.
 */

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { renderGeneratedManifest, selectAndBuildFeeds } from "./chainlinkFeedSelection.mjs";

const SOURCE_URL = "https://reference-data-directory.vercel.app/feeds-mainnet.json";
const OUTPUT_PATH = fileURLToPath(
  new URL("../src/chainlink/ethereumMainnetPriceFeeds.generated.ts", import.meta.url),
);

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Chainlink feed metadata request failed with HTTP status ${response.status}.`);
  }
  const bodyText = await response.text();

  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new Error(`Chainlink feed metadata response was not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Chainlink feed metadata response must be a JSON array.");
  }

  const sourceSha256 = createHash("sha256").update(bodyText).digest("hex");
  const retrievedAt = new Date().toISOString();

  const feeds = selectAndBuildFeeds(parsed);
  console.log(`Selected ${feeds.length} standard Ethereum Mainnet Crypto/USD feeds out of ${parsed.length} entries.`);

  const source = renderGeneratedManifest(feeds, { sourceUrl: SOURCE_URL, retrievedAt, sourceSha256 });
  await writeFile(OUTPUT_PATH, source, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Source SHA-256: ${sourceSha256}`);
  console.log("Review the diff against https://docs.chain.link/data-feeds/price-feeds/addresses before committing.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
