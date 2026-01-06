// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

import buildCanFill from "../../src/utils/rhythm/buildCanFill";

test("buildCanFill computes reachable totals", () => {
  const canFill = buildCanFill(11, [2, 3, 4, 5]);

  assert.equal(canFill[0], true);
  assert.equal(canFill[1], false);
  assert.equal(canFill[4], true);
  assert.equal(canFill[7], true);
  assert.equal(canFill[11], true);
});

test("buildCanFill ignores non-positive sizes", () => {
  const canFill = buildCanFill(5, [0, -1, 3]);

  assert.deepEqual(canFill.slice(0, 6), [true, false, false, true, false, false]);
});
