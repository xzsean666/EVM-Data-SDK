/**
 * Unbiased random permutation for Archive RPC endpoint selection.
 *
 * Reuses the existing `RandomSource` contract from `src/execution/clock.ts`
 * (already injected into `RequestExecutor`) instead of defining a second,
 * differently-shaped randomness abstraction. Production code uses the
 * exported `systemRandom` from that module; tests inject a deterministic
 * sequence so endpoint selection, restart-on-failure, and no-repeat behavior
 * are reproducible without real randomness.
 */
import type { RandomSource } from "../execution/clock";

export type { RandomSource };

/**
 * Fisher-Yates shuffle. Produces an unbiased permutation given a uniform
 * `randomSource.next()` returning values in `[0, 1)`. Does not mutate input.
 */
export function shuffle<T>(values: readonly T[], randomSource: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomSource.next() * (index + 1));
    const temp = result[index]!;
    result[index] = result[swapIndex]!;
    result[swapIndex] = temp;
  }
  return result;
}
