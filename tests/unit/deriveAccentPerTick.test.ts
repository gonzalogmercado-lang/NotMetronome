// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

import { ACCENT_GAIN, accentPatternGlyphs, deriveAccentPerTick } from "../../src/utils/rhythm/deriveAccentPerTick";

test("deriveAccentPerTick marks compound groupings for 12/8", () => {
  const accent = deriveAccentPerTick({ n: 12, d: 8 });

  assert.equal(accent.length, 12);
  assert.equal(accent[0], "BAR");
  assert.equal(accent[3], "GROUP");
  assert.equal(accent[6], "GROUP");
  assert.equal(accent[9], "GROUP");
  assert.equal(accentPatternGlyphs(accent), "F x x m x x m x x m x x");
  assert.ok(accent.every((level) => ACCENT_GAIN[level] > 0));
});

test("deriveAccentPerTick respects custom groups without overflow", () => {
  const accent = deriveAccentPerTick({ n: 11, d: 8 }, [3, 3, 3, 2]);

  assert.equal(accent.length, 11);
  assert.equal(accent[0], "BAR");
  assert.equal(accent[3], "GROUP");
  assert.equal(accent[6], "GROUP");
  assert.equal(accent[9], "GROUP");
  assert.equal(accent[10], "WEAK");
  assert.equal(accentPatternGlyphs(accent), "F x x m x x m x x m x");
});
