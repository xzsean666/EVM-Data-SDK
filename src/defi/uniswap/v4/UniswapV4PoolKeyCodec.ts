const KECCAK_ROUND_CONSTANTS: readonly bigint[] = Object.freeze([
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]);

const ROTATION_OFFSETS: readonly (readonly number[])[] = Object.freeze([
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
]);

export function keccak256(data: Uint8Array | Buffer): string {
  const rate = 136;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = buf.length;
  const padLen = rate - (len % rate);
  const padded = Buffer.alloc(len + padLen);
  buf.copy(padded);
  padded[len] = 0x01;
  const lastIndex = padded.length - 1;
  padded[lastIndex] = (padded[lastIndex] ?? 0) | 0x80;

  const state = new BigUint64Array(25);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < 17; i++) {
      state[i] = (state[i] ?? 0n) ^ padded.readBigUInt64LE(offset + i * 8);
    }
    for (let round = 0; round < 24; round++) {
      const C = new BigUint64Array(5);
      for (let x = 0; x < 5; x++) {
        C[x] =
          (state[x] ?? 0n) ^
          (state[x + 5] ?? 0n) ^
          (state[x + 10] ?? 0n) ^
          (state[x + 15] ?? 0n) ^
          (state[x + 20] ?? 0n);
      }
      const D = new BigUint64Array(5);
      for (let x = 0; x < 5; x++) {
        const left = C[(x + 1) % 5] ?? 0n;
        const rot = (left << 1n) | (left >> 63n);
        D[x] = (C[(x + 4) % 5] ?? 0n) ^ rot;
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          const idx = x + y * 5;
          state[idx] = (state[idx] ?? 0n) ^ (D[x] ?? 0n);
        }
      }
      const B = new BigUint64Array(25);
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          const shift = BigInt(ROTATION_OFFSETS[x]?.[y] ?? 0);
          const val = state[x + y * 5] ?? 0n;
          B[y + ((2 * x + 3 * y) % 5) * 5] = shift === 0n ? val : (val << shift) | (val >> (64n - shift));
        }
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          const b1 = B[((x + 1) % 5) + y * 5] ?? 0n;
          const b2 = B[((x + 2) % 5) + y * 5] ?? 0n;
          state[x + y * 5] = (B[x + y * 5] ?? 0n) ^ ((~b1) & b2);
        }
      }
      state[0] = (state[0] ?? 0n) ^ (KECCAK_ROUND_CONSTANTS[round] ?? 0n);
    }
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) {
    out.writeBigUInt64LE(state[i] ?? 0n, i * 8);
  }
  return "0x" + out.toString("hex");
}

export function encodePoolKey(pool: {
  readonly currency0: string;
  readonly currency1: string;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: string;
}): string {
  for (const a of [pool.currency0, pool.currency1, pool.hooks]) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("Invalid PoolKey address.");
  }
  if (pool.currency0.toLowerCase() >= pool.currency1.toLowerCase()) {
    throw new Error("PoolKey currencies must be canonically sorted.");
  }
  if (
    !Number.isInteger(pool.fee) ||
    pool.fee < 0 ||
    pool.fee > 0xffffff ||
    !Number.isInteger(pool.tickSpacing) ||
    pool.tickSpacing < -32768 ||
    pool.tickSpacing > 32767
  ) {
    throw new Error("Invalid PoolKey fields.");
  }
  const word = (v: string) => v.slice(2).toLowerCase().padStart(64, "0");
  const uint = (v: number) => BigInt(v).toString(16).padStart(64, "0");
  const signed = (v: number) =>
    (v < 0 ? (1n << 256n) + BigInt(v) : BigInt(v)).toString(16).padStart(64, "0");
  return `0x${word(pool.currency0)}${word(pool.currency1)}${uint(pool.fee)}${signed(pool.tickSpacing)}${word(pool.hooks)}`;
}

export function poolIdFromKey(encodedPoolKey: string): string {
  if (!/^0x[0-9a-fA-F]{320}$/.test(encodedPoolKey)) {
    throw new Error("Invalid encoded PoolKey.");
  }
  return keccak256(Buffer.from(encodedPoolKey.slice(2), "hex"));
}
