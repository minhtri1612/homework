// Shuffling that gives the same order every time for the same seed, so a
// student who reloads the answer page sees the questions in the same order,
// and the result page can show them in that order again.
import { createHash } from 'node:crypto';

/** A copy of items in an order that depends only on seed (Fisher–Yates). */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  const random = randomFrom(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// mulberry32, seeded with the first 4 bytes of SHA-256(seed): numbers in [0, 1).
function randomFrom(seed: string): () => number {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
