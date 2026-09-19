import type { KlinePoint } from "../../domain/klineModels";

export const KLINE_RECORD_SIZE = 16; // 8 bytes timestamp_ms (UInt64LE) + 8 bytes price_usd (DoubleLE)

export class KlineBinaryCodec {
  /**
   * Serializes an array of KlinePoint items into a contiguous 16-byte fixed-length binary Buffer.
   */
  static encode(points: readonly KlinePoint[]): Buffer {
    // Sort ascending by timestamp and deduplicate
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const deduped: KlinePoint[] = [];
    let lastTs = -1;
    for (const p of sorted) {
      if (p.timestamp !== lastTs) {
        deduped.push(p);
        lastTs = p.timestamp;
      }
    }

    const buffer = Buffer.alloc(deduped.length * KLINE_RECORD_SIZE);
    for (let i = 0; i < deduped.length; i++) {
      const offset = i * KLINE_RECORD_SIZE;
      const point = deduped[i]!;
      buffer.writeBigUInt64LE(BigInt(point.timestamp), offset);
      buffer.writeDoubleLE(Number(point.priceUsd), offset + 8);
    }
    return buffer;
  }

  /**
   * Decodes a binary buffer into KlinePoint[], optionally slicing by [startMs, endMs) using O(log N) binary search.
   */
  static decode(buffer: Buffer, startMs?: number, endMs?: number): KlinePoint[] {
    const totalRecords = Math.floor(buffer.length / KLINE_RECORD_SIZE);
    if (totalRecords === 0) return [];

    let startIndex = 0;
    let endIndex = totalRecords;

    if (startMs !== undefined) {
      startIndex = this.binarySearchLower(buffer, totalRecords, BigInt(startMs));
    }
    if (endMs !== undefined) {
      endIndex = this.binarySearchLower(buffer, totalRecords, BigInt(endMs));
    }

    const count = Math.max(0, endIndex - startIndex);
    const points: KlinePoint[] = new Array(count);

    for (let i = 0; i < count; i++) {
      const offset = (startIndex + i) * KLINE_RECORD_SIZE;
      const timestamp = Number(buffer.readBigUInt64LE(offset));
      const priceNum = buffer.readDoubleLE(offset + 8);
      points[i] = {
        timestamp,
        priceUsd: formatPrice(priceNum),
      };
    }

    return points;
  }

  /**
   * Finds the first record whose timestamp >= targetTs (lower_bound).
   */
  private static binarySearchLower(buffer: Buffer, totalRecords: number, targetTs: bigint): number {
    let low = 0;
    let high = totalRecords;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const midTs = buffer.readBigUInt64LE(mid * KLINE_RECORD_SIZE);
      if (midTs < targetTs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  // Avoid scientific notation for standard prices
  const str = String(value);
  if (!str.includes("e") && !str.includes("E")) return str;
  return value.toFixed(8).replace(/\.?0+$/, "");
}
