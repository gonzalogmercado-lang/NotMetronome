export function buildCanFill(total: number, allowedSizes: number[]): boolean[] {
  const normalizedAllowed = allowedSizes.filter((size) => size > 0);
  const canFill = Array.from({ length: total + 1 }, () => false);
  canFill[0] = true;

  for (let amount = 1; amount <= total; amount += 1) {
    canFill[amount] = normalizedAllowed.some((size) => size <= amount && canFill[amount - size]);
  }

  return canFill;
}

if (typeof __DEV__ !== "undefined" && __DEV__) {
  const sample = buildCanFill(11, [2, 3, 4, 5]);
  const remainingAfterSeven = 4;
  const remainingAfterSevenPlusThree = 1;
  console.log("[dev:self-check] buildCanFill total=11 allowed [2,3,4,5]");
  console.log("[dev:self-check] can fill remaining 4?", sample[remainingAfterSeven]);
  console.log("[dev:self-check] can fill remaining 1?", sample[remainingAfterSevenPlusThree]);
}

export default buildCanFill;
