import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore } from '../src/grading.js';

test('rounds to the nearest 0.25', () => {
  assert.equal(computeScore(71, 100), 7); // 7.1
  assert.equal(computeScore(713, 1000), 7.25); // 7.13
  assert.equal(computeScore(1, 3), 3.25); // 3.33…
  assert.equal(computeScore(2, 3), 6.75); // 6.66…
});

test('an exact tie rounds up', () => {
  assert.equal(computeScore(57, 80), 7.25); // 7.125
  assert.equal(computeScore(1, 8), 1.25); // 1.25 exactly: no rounding
  assert.equal(computeScore(1, 80), 0.25); // 0.125
  assert.equal(computeScore(79, 80), 10); // 9.875
});

test('all wrong is 0, all right is 10', () => {
  assert.equal(computeScore(0, 7), 0);
  assert.equal(computeScore(7, 7), 10);
});
