function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function summarizeDirections(items, changeField = "change") {
  let increaseTotal = 0;
  let decreaseTotal = 0;
  for (const item of items || []) {
    const change = toFiniteNumber(item?.[changeField]);
    if (change > 0) increaseTotal += change;
    if (change < 0) decreaseTotal += Math.abs(change);
  }
  return { increase_total: increaseTotal, decrease_total: decreaseTotal };
}

function projectDirectionalImpacts(items, options = {}) {
  const { changeField = "change", directionLimit = 5 } = options;
  const source = Array.isArray(items) ? items : [];
  const totals = summarizeDirections(source, changeField);
  const projected = source.map((item) => {
    const {
      contributionRate: _contributionRate,
      占比: _share,
      ...rest
    } = item || {};
    const change = toFiniteNumber(rest[changeField]);
    if (change > 0) {
      return {
        ...rest,
        direction: "increase",
        direction_share:
          totals.increase_total > 0 ? change / totals.increase_total : 0,
      };
    }
    if (change < 0) {
      return {
        ...rest,
        direction: "decrease",
        direction_share:
          totals.decrease_total > 0
            ? Math.abs(change) / totals.decrease_total
            : 0,
      };
    }
    return { ...rest, direction: "unchanged" };
  });

  const increases = projected
    .filter((item) => item.direction === "increase")
    .sort(
      (a, b) =>
        toFiniteNumber(b[changeField]) - toFiniteNumber(a[changeField]),
    );
  const decreases = projected
    .filter((item) => item.direction === "decrease")
    .sort(
      (a, b) =>
        Math.abs(toFiniteNumber(b[changeField])) -
        Math.abs(toFiniteNumber(a[changeField])),
    );
  const limit = Number.isInteger(directionLimit) && directionLimit >= 0
    ? directionLimit
    : 5;

  return {
    items: projected,
    ...totals,
    top_increase: increases[0] || null,
    top_decrease: decreases[0] || null,
    top_increases: increases.slice(0, limit),
    top_decreases: decreases.slice(0, limit),
  };
}

module.exports = {
  projectDirectionalImpacts,
  summarizeDirections,
};
