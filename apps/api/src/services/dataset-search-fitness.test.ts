import assert from "node:assert/strict";
import test from "node:test";

import { datasetSearchFitnessAdjustment } from "./dataset-search-fitness.js";

const query = "3 inch 304L stainless butt weld fit and weld man hours";

test("combined piping data outranks welding-only carbon steel for fit-and-weld stainless questions", () => {
  const combined = datasetSearchFitnessAdjustment(query, {
    name: "Piping Man-Hour Data",
    description: "Pipe welding estimating data by nominal diameter",
    tags: ["piping", "welding", "man-hours"],
    columns: [
      { key: "NumberOfPasses" },
      { key: "MinutesPerInch" },
      { key: "FittingHrs" },
      { key: "StainlessPercentAdder" },
    ],
  });
  const weldingOnly = datasetSearchFitnessAdjustment(query, {
    name: "Manual Butt Welds",
    description: "Labor for welding only. Carbon steel materials.",
    columns: [{ key: "pipe_size_inches" }, { key: "sch_40" }],
  });

  assert.equal(combined, 30);
  assert.equal(weldingOnly, -36);
  assert.ok(combined > weldingOnly);
});

