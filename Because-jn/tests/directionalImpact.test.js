const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { projectDirectionalImpacts } = require("../utils/directionalImpact");
const {
  analyzeAdditiveFromComponents,
} = require("../utils/additiveAttribution");
const DimensionDrillDown = require("../utils/dimensionDrillDown");
const {
  runMultiplicativeAttribution,
} = require("../utils/multiplicativeAttribution");
const { runDivisiveAttribution } = require("../utils/divisiveAttribution");
const {
  buildStructuredAttributionNextSteps,
} = require("../utils/drillDownHints");
const FluctuationAttributionTool = require("../fluctuation-attribution-tool/scripts/FluctuationAttributionTool");

function assertNoLegacySchema(value) {
  const json = JSON.stringify(value);
  assert.doesNotMatch(
    json,
    /contributionRate|"占比"|"topContributor"|numerator_contrib|denominator_contrib|"contribution"/,
  );
}

describe("directional impact projection", () => {
  it("separates increase and decrease denominators and omits share for unchanged", () => {
    const result = projectDirectionalImpacts([
      { value: "A", change: 100 },
      { value: "B", change: 3 },
      { value: "C", change: -3 },
      { value: "D", change: 0 },
    ]);

    assert.equal(result.increase_total, 103);
    assert.equal(result.decrease_total, 3);
    assert.equal(
      result.items.find((item) => item.value === "A").direction_share,
      100 / 103,
    );
    assert.equal(
      result.items.find((item) => item.value === "C").direction_share,
      1,
    );
    assert.equal(
      result.items.find((item) => item.value === "D").direction,
      "unchanged",
    );
    assert.equal(
      "direction_share" in result.items.find((item) => item.value === "D"),
      false,
    );
    assert.equal(result.top_increase.value, "A");
    assert.equal(result.top_decrease.value, "C");
    assert.deepEqual(result.top_increases.map((item) => item.value), ["A", "B"]);
    assert.deepEqual(result.top_decreases.map((item) => item.value), ["C"]);
  });

  it("uses full direction totals before TopN truncation", () => {
    const baseData = [{ total: 0, a: 0, b: 0, c: 0, d: 0 }];
    const currentData = [{ total: 94, a: 60, b: 30, c: 10, d: -6 }];
    const result = analyzeAdditiveFromComponents({
      baseData,
      currentData,
      targetMetric: "total",
      componentMetrics: ["a", "b", "c", "d"],
      maxComponents: 2,
    });

    assert.deepEqual(
      result.components.map((item) => item.metric),
      ["a", "b"],
    );
    assert.equal(result.components[0].direction_share, 0.6);
    assert.ok(
      Math.abs(
        result.components.reduce((sum, item) => sum + item.direction_share, 0) -
          0.9,
      ) < 1e-12,
    );
    assert.equal(result.top_decrease.metric, "d");
    assert.deepEqual(result.omitted_summary, {
      count: 2,
      net_change: 4,
      increase_count: 1,
      decrease_count: 1,
      increase_total: 10,
      decrease_total: 6,
    });
    assertNoLegacySchema(result);
  });
});

describe("attribution public schemas", () => {
  it("keeps Adtributor signed ratios internal while exposing direction shares", () => {
    const result = DimensionDrillDown.analyze({
      baseData: [
        { org: "A", value: 100 },
        { org: "B", value: 100 },
      ],
      currentData: [
        { org: "A", value: 130 },
        { org: "B", value: 90 },
      ],
      metricField: "value",
      dimensionFields: ["org"],
    });
    const items = result.dimensionRanking[0].topContributors;
    assert.equal(items[0].direction, "increase");
    assert.equal(items[1].direction, "decrease");
    assert.ok(items.every((item) => item.direction_share >= 0));
    assertNoLegacySchema(result);
  });

  it("keeps offsetting increase and decrease items when net change is zero", () => {
    const result = DimensionDrillDown.analyze({
      baseData: [
        { org: "A", value: 100 },
        { org: "B", value: 100 },
      ],
      currentData: [
        { org: "A", value: 110 },
        { org: "B", value: 90 },
      ],
      metricField: "value",
      dimensionFields: ["org"],
    });
    const ranking = result.dimensionRanking[0];
    assert.equal(result.overview.totalChange, 0);
    assert.equal(ranking.increase_total, 10);
    assert.equal(ranking.decrease_total, 10);
    assert.equal(ranking.topContributors.length, 2);
    assert.ok(
      ranking.topContributors.every((item) => item.direction_share === 1),
    );
    assertNoLegacySchema(result);
  });

  it("selects visible Top3 from all items while retaining significance for scoring", () => {
    const result = DimensionDrillDown.analyze({
      baseData: [
        { org: "A", value: 0 },
        { org: "B", value: 0 },
        { org: "C", value: 0 },
      ],
      currentData: [
        { org: "A", value: 1000 },
        { org: "B", value: 5 },
        { org: "C", value: 1 },
      ],
      metricField: "value",
      dimensionFields: ["org"],
    });
    const ranking = result.dimensionRanking[0];
    assert.deepEqual(
      ranking.topContributors.map((item) => item.value),
      ["A", "B", "C"],
    );
    assert.equal(ranking.significantContributors, 1);
  });

  it("sorts drill paths by first-level absolute change, not direction share", () => {
    const result = DimensionDrillDown.analyze({
      baseData: [
        { org: "A", product: "P1", value: 100 },
        { org: "B", product: "P2", value: 100 },
      ],
      currentData: [
        { org: "A", product: "P1", value: 220 },
        { org: "B", product: "P2", value: 90 },
      ],
      metricField: "value",
      dimensionFields: ["org", "product"],
      compact: false,
    });
    assert.equal(result.drillPaths[0].steps[0].value, "A");
    assert.equal(result.drillPaths[0].steps[0].change, 120);
  });

  it("projects top increase and decrease with the same public schema", () => {
    const result = DimensionDrillDown.analyze({
      baseData: [
        { org: "A", value: 100 },
        { org: "B", value: 100 },
      ],
      currentData: [
        { org: "A", value: 120 },
        { org: "B", value: 90 },
      ],
      metricField: "value",
      dimensionFields: ["org"],
    });
    const ranking = result.dimensionRanking[0];
    const expectedKeys = [
      "baseValue",
      "change",
      "changeRate",
      "currentValue",
      "direction",
      "direction_share",
      "value",
    ];
    assert.deepEqual(Object.keys(ranking.top_increase).sort(), expectedKeys);
    assert.deepEqual(Object.keys(ranking.top_decrease).sort(), expectedKeys);
    assert.equal(ranking.top_increase.changeRate, "20.00%");
    assert.equal(ranking.top_decrease.changeRate, "-10.00%");
  });

  it("returns separately sorted Top5 direction lists from the full dimension input", () => {
    const changes = [90, -80, 70, -60, 50, -40, 30, -20, 10, -5, 1, -1];
    const baseData = changes.map((_, index) => ({ org: `O${index}`, value: 100 }));
    const currentData = changes.map((change, index) => ({
      org: `O${index}`,
      value: 100 + change,
    }));
    const result = DimensionDrillDown.analyze({
      baseData,
      currentData,
      metricField: "value",
      dimensionFields: ["org"],
    });
    const ranking = result.dimensionRanking[0];

    assert.deepEqual(
      ranking.top_increases.map((item) => item.change),
      [90, 70, 50, 30, 10],
    );
    assert.deepEqual(
      ranking.top_decreases.map((item) => item.change),
      [-80, -60, -40, -20, -5],
    );
    assert.equal(ranking.topContributors.length, 3);
    assert.ok(ranking.top_increases.every((item) => item.direction_share >= 0));
    assert.ok(ranking.top_decreases.every((item) => item.direction_share >= 0));
  });

  it("returns an empty direction list when the full input has no such direction", () => {
    const result = DimensionDrillDown.analyze({
      baseData: [{ org: "A", value: 100 }, { org: "B", value: 100 }],
      currentData: [{ org: "A", value: 120 }, { org: "B", value: 110 }],
      metricField: "value",
      dimensionFields: ["org"],
    });
    const ranking = result.dimensionRanking[0];
    assert.equal(ranking.top_increases.length, 2);
    assert.deepEqual(ranking.top_decreases, []);
    assert.equal(ranking.top_decrease, null);
  });

  it("selects additive next step by largest absolute change across directions", () => {
    const steps = buildStructuredAttributionNextSteps(
      {
        type: "additive",
        targetMetric: "value",
        top_increase: {
          value: "A",
          label: "A",
          metric: "org",
          change: 120,
          direction: "increase",
        },
        top_decrease: {
          value: "B",
          label: "B",
          metric: "org",
          change: -10,
          direction: "decrease",
        },
      },
      "value",
    );
    assert.match(steps[0].action, /A/);
    assert.match(steps[0].question, /增加 120/);
  });

  it("uses drive impact for multiplicative attribution", () => {
    const result = runMultiplicativeAttribution({
      baseData: [{ total: 10, users: 2, value: 5 }],
      currentData: [{ total: 18, users: 3, value: 6 }],
      targetMetric: "total",
      componentMetrics: ["users", "value"],
    });
    assert.equal(result.top_driver.drive_impact, 5);
    assert.ok(result.factors.every((factor) => "drive_impact" in factor));
    assertNoLegacySchema(result);
  });

  it("uses numerator and denominator impact for divisive attribution", () => {
    const result = runDivisiveAttribution({
      baseData: [{ numerator: 10, denominator: 100 }],
      currentData: [{ numerator: 12, denominator: 150 }],
      numeratorField: "numerator",
      denominatorField: "denominator",
    });
    assert.equal(result.decomposition.numerator_impact, 0.02);
    assert.equal(result.decomposition.denominator_impact, -0.05);
    assertNoLegacySchema(result);
  });
});

describe("fluctuation attribution tool serialization", () => {
  const input = {
    analysis_type: "comprehensive",
    base_data: [
      { org: "A", value: 100 },
      { org: "B", value: 100 },
      { org: "C", value: 100 },
    ],
    current_data: [
      { org: "A", value: 200 },
      { org: "B", value: 103 },
      { org: "C", value: 97 },
    ],
    metric_fields: ["value"],
    dimension_fields: ["org"],
    metric_structure: "additive",
  };

  it("returns the directional schema in compact output", async () => {
    const output = JSON.parse(
      await new FluctuationAttributionTool()._call({ ...input, compact: true }),
    );
    assert.equal(output.top_dimension.increase_total, 103);
    assert.equal(output.top_dimension.decrease_total, 3);
    assert.deepEqual(
      output.top_dimension.top_increases.map((item) => item.value),
      ["A", "B"],
    );
    assert.deepEqual(
      output.top_dimension.top_decreases.map((item) => item.value),
      ["C"],
    );
    assert.equal(output.structured.top_increase.direction, "increase");
    assert.equal(output.structured.top_decrease.direction, "decrease");
    assert.match(output.conclusion, /全部增加项|全部减少项/);
    assertNoLegacySchema(output);
  });

  it("does not serialize internal signed ratios in verbose output", async () => {
    const output = JSON.parse(
      await new FluctuationAttributionTool()._call({
        ...input,
        compact: false,
      }),
    );
    assert.equal(output.structured_attribution.increase_total, 103);
    assert.equal(output.structured_attribution.decrease_total, 3);
    assertNoLegacySchema(output);
  });
});
