// Scoring on a 10-point scale. Used by the student flow (PLAN.md Step 6);
// see .claude/docs/grading.md.

/**
 * correct / total × 10 rounded to the nearest 0.25; an exact tie goes up
 * (57 of 80 = 7.125 → 7.25; 1 of 3 = 3.33… → 3.25). correct * 40 is an integer, so there is only one
 * floating-point division and no float error near the halfway points.
 */
export function computeScore(correct: number, total: number): number {
  return Math.round((correct * 40) / total) / 4;
}

const SCORE = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

/** 7.25 → "7,25" (Vietnamese decimal comma). */
export function formatScore(score: number): string {
  return SCORE.format(score);
}
