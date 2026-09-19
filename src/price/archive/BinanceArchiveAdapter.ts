import zlib from "node:zlib";
import type { ArchiveProviderAdapter } from "./ArchiveProviderAdapter";
import type { KlinePoint } from "../../domain/klineModels";

export class BinanceArchiveAdapter implements ArchiveProviderAdapter {
  readonly provider = "binance" as const;

  getMonthlyArchiveUrl(symbol: string, interval: string, year: number, month: number): string {
    const pair = symbol.toUpperCase().endsWith("USDT") ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
    const mm = String(month).padStart(2, "0");
    return `https://data.binance.vision/data/spot/monthly/klines/${pair}/${interval}/${pair}-${interval}-${year}-${mm}.zip`;
  }

  parseArchive(rawData: Buffer): KlinePoint[] {
    const csvContent = extractSingleFileFromZip(rawData);
    const lines = csvContent.split("\n");
    const points: KlinePoint[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const cols = trimmed.split(",");
      if (cols.length < 5) continue;

      const timestamp = Number(cols[0]);
      const close = cols[4];

      // Validate numeric timestamp and price
      if (Number.isSafeInteger(timestamp) && timestamp > 0 && typeof close === "string") {
        const priceNum = Number(close);
        if (Number.isFinite(priceNum) && priceNum > 0) {
          points.push({
            timestamp,
            priceUsd: close,
          });
        }
      }
    }

    return points;
  }
}

/**
 * Decompresses the first file inside a ZIP buffer using pure Node.js zlib.
 */
function extractSingleFileFromZip(buf: Buffer): string {
  if (buf.length < 30) {
    throw new Error("Invalid ZIP archive: buffer too small.");
  }
  const sig = buf.readUInt32LE(0);
  if (sig !== 0x04034b50) {
    throw new Error(`Invalid ZIP signature: 0x${sig.toString(16)}`);
  }

  const compMethod = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const fileNameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const dataStart = 30 + fileNameLen + extraLen;

  let compressedData: Buffer;
  if (compSize > 0) {
    compressedData = buf.subarray(dataStart, dataStart + compSize);
  } else {
    // If compressed size is 0 in local header, extract until central directory signature 0x02014b50
    const centralSig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const centralIdx = buf.indexOf(centralSig, dataStart);
    compressedData = centralIdx !== -1 ? buf.subarray(dataStart, centralIdx) : buf.subarray(dataStart);
  }

  if (compMethod === 8) {
    // Deflated
    return zlib.inflateRawSync(compressedData).toString("utf-8");
  } else if (compMethod === 0) {
    // Stored (no compression)
    return compressedData.toString("utf-8");
  } else {
    throw new Error(`Unsupported ZIP compression method: ${compMethod}`);
  }
}
