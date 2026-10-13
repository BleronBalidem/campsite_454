/**
 * TM05-72: the campsite marker colour matches the score the trail list and panel show.
 *
 * grade.test.ts checks the expression's shape; these run it through MapLibre's own
 * expression evaluator, so they pin what the map actually paints for a feature -- each
 * grade boundary, a null score and a missing one -- and that it agrees with gradeFor(),
 * which the panel and the pin colour use.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { expression } from "@maplibre/maplibre-gl-style-spec";
import { gradeFor, scoreColorExpression, type ScoreColors } from "../src/score/grade.ts";

const colors: ScoreColors = { A: "a", B: "b", C: "c", D: "d", F: "f", none: "none" };

const compiled = expression.createExpression(
  scoreColorExpression(colors),
  "layers[campsites-point].paint.circle-color",
);
if (compiled.result !== "success") throw new Error(JSON.stringify(compiled.value));
const evaluator = compiled.value;

/** The colour MapLibre paints a campsite marker with these feature properties. */
function markerColour(properties: Record<string, unknown>): unknown {
  return evaluator.evaluate({ zoom: 13 }, { type: "Point", properties });
}

test("each grade boundary lands on the higher grade", () => {
  const cases: [number, string][] = [
    [100, "a"],
    [90, "a"],
    [89.9, "b"],
    [80, "b"],
    [79.9, "c"],
    [70, "c"],
    [69.9, "d"],
    [60, "d"],
    [59.9, "f"],
    [0, "f"],
  ];
  for (const [score, colour] of cases) {
    assert.equal(markerColour({ score }), colour, `score ${score}`);
  }
});

test("a null score is the no-score colour, never F", () => {
  assert.equal(markerColour({ score: null }), "none");
});

test("a missing score is the no-score colour, never F", () => {
  assert.equal(markerColour({}), "none");
  assert.equal(markerColour({ name: "Flowed Lands lean-to" }), "none");
});

test("a score sent as a string is not a score", () => {
  assert.equal(markerColour({ score: "85" }), "none");
});

test("the marker and the panel's grade agree on every score", () => {
  for (let score = 0; score <= 100; score += 0.5) {
    assert.equal(markerColour({ score }), gradeFor(score)!.toLowerCase(), `score ${score}`);
  }
});
