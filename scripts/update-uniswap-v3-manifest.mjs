#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { selectUniswapV3Candidates, renderUniswapV3Manifest } from "./uniswapV3ManifestSelection.mjs";

// The updater is intentionally maintainer-only. Runtime SDK code never imports it.
const input = process.env.UNISWAP_V3_CANDIDATES;
if (input === undefined) {
  console.error("Set UNISWAP_V3_CANDIDATES to a reviewed candidate JSON file.");
  process.exitCode = 1;
} else {
  const candidates = JSON.parse(await readFile(input, "utf8"));
  const top = process.argv.includes("--top") ? Number(process.argv[process.argv.indexOf("--top") + 1]) : undefined;
  const selected = selectUniswapV3Candidates(candidates, { ...(top === undefined ? {} : { top }) });
  process.stdout.write(renderUniswapV3Manifest(selected, process.env.UNISWAP_V3_SOURCE_SNAPSHOT ?? "review-required"));
}
