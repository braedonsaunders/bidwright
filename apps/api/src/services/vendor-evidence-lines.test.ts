import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  extractLinesFromTables,
  extractLinesFromText,
  extractVendorEvidenceLines,
  isCredibleResourceMatch,
  preferSkuBackedLines,
} from "./vendor-evidence-lines.js";

const PINACLE_HEADERS = [
  "Line QTY\n# ORD",
  "CUSTOMER CODE\nPINACLE CODE",
  "",
  "",
  "UNIT COST",
  "LINE TOTAL",
];

const PINACLE_ROWS = [
  ["1\n120FT", "304/304L A/SA-312 WELDED PIPE\n2 10S x 20 304LPW102", "", "", "8.100", "972.00"],
  ["2\n80FT", "304/304L A/SA-312 WELDED PIPE\n3 10S x 20 304LPW103", "", "", "12.100", "968.00"],
  ["3\n40FT", "304/304L A/SA-312 WELDED PIPE\n1-1/2 10S x 20 304LPW1015", "", "", "5.300", "212.00"],
  ["4\n20 EA", "304/304L A/SA-182 FLANGE 125-250 AARH 45-55GPI\n2 RF WELDNECK CL 150 10S 304LFAWN102", "", "", "32.900", "658.00"],
  ["5\n12 EA", "304/304L A/SA-182 FLANGE 125-250 AARH 45-55GPI\n3 RF WELDNECK CL 150 10S 304LFAWN103", "", "", "55.240", "662.88"],
  ["6\n8 EA", "304/304L A/SA-182 FLANGE 125-250 AARH 45-55GPI\n1-1/2 RF WELDNECK CL150 10S 304LFAWN1015", "", "", "22.950", "183.60"],
  ["7\n16 EA", "304/304L WP A/SA-403W BUTT-WELD\n2 10S 90 DEG ELBOW L/R 304LWP10902", "", "", "7.320", "117.12"],
  ["8\n8 EA", "304/304L A/SA-403 WPS BUTT-WELD SEAMLESS\n2 10S 45 DEG ELBOW 304LWS10452", "", "", "7.220", "57.76"],
  ["9\n4 EA", "304/304L WP A/SA-403W BUTT-WELD\n2 x 1-1/2 10S CONC RED 304LWP10CR200015", "", "", "7.360", "29.44"],
  ["10\n8 EA", "304/304L WP A/SA-403W BUTT-WELD\n3 10S 90 DEG ELBOW L/R 304LWP10903", "", "", "16.230", "129.84"],
  ["11\n8 EA", "304/304L WP A/SA-403W BUTT-WELD\n2 10S TEE 304LWP10T2", "", "", "12.800", "102.40"],
];

const PINACLE_TEXT = `Q U O T A T I O N
T390411
Line QTY CUSTOMER CODE
UNIT COST LINE TOTAL
# ORD PINACLE CODE
1 304/304L A/SA-312 WELDED PIPE
120FT 2 10S x 20 304LPW102 8.100 972.00
2 304/304L A/SA-312 WELDED PIPE
80FT 3 10S x 20 304LPW103 12.100 968.00
3 304/304L A/SA-312 WELDED PIPE
40FT 1-1/2 10S x 20 304LPW1015 5.300 212.00
4 304/304L A/SA-182 FLANGE 125-250 AARH 45-55GPI
20 EA 2 RF WELDNECK CL 150 10S 304LFAWN102 32.900 658.00
5 304/304L A/SA-182 FLANGE 125-250 AARH 45-55GPI
12 EA 3 RF WELDNECK CL 150 10S 304LFAWN103 55.240 662.88
6 304/304L A/SA-182 FLANGE 125-250 AARH 45-55GPI
8 EA 1-1/2 RF WELDNECK CL150 10S 304LFAWN1015 22.950 183.60
7 304/304L WP A/SA-403W BUTT-WELD
16 EA 2 10S 90 DEG ELBOW L/R 304LWP10902 7.320 117.12
8 304/304L A/SA-403 WPS BUTT-WELD SEAMLESS
8 EA 2 10S 45 DEG ELBOW 304LWS10452 7.220 57.76
9 304/304L WP A/SA-403W BUTT-WELD
4 EA 2 x 1-1/2 10S CONC RED 304LWP10CR200015 7.360 29.44
10 304/304L WP A/SA-403W BUTT-WELD
8 EA 3 10S 90 DEG ELBOW L/R 304LWP10903 16.230 129.84
11 304/304L WP A/SA-403W BUTT-WELD
8 EA 2 10S TEE 304LWP10T2 12.800 102.40`;

test("Pinacle quote tables yield every priced line with the vendor SKU", () => {
  const lines = extractLinesFromTables(
    [{ pageNumber: 1, headers: PINACLE_HEADERS, rows: PINACLE_ROWS, rawMarkdown: "" }],
    () => "CAD",
  );
  assert.equal(lines.length, 11);
  assert.deepEqual(lines.map((line) => line.vendorSku), [
    "304LPW102",
    "304LPW103",
    "304LPW1015",
    "304LFAWN102",
    "304LFAWN103",
    "304LFAWN1015",
    "304LWP10902",
    "304LWS10452",
    "304LWP10CR200015",
    "304LWP10903",
    "304LWP10T2",
  ]);
  const elbow = lines.find((line) => line.vendorSku === "304LWP10902");
  assert.equal(elbow?.quantity, 16);
  assert.equal(elbow?.uom, "EA");
  assert.equal(elbow?.unitCost, 7.32);
  assert.match(elbow?.description ?? "", /90 DEG ELBOW/);
  const pipe = lines.find((line) => line.vendorSku === "304LPW102");
  assert.equal(pipe?.quantity, 120);
  assert.equal(pipe?.uom, "FT");
  assert.equal(pipe?.unitCost, 8.1);
});

test("Pinacle stacked quote text also recovers all eleven lines", () => {
  const lines = extractLinesFromText(PINACLE_TEXT, "CAD", 1);
  assert.equal(lines.length, 11);
  assert.ok(lines.every((line) => line.vendorSku.startsWith("304")));
  assert.equal(lines.find((line) => line.vendorSku === "304LWP10T2")?.quantity, 8);
});

test("generic invoice rows are dropped when the same priced SKU line exists", () => {
  const lines = preferSkuBackedLines([
    {
      description: "2\" 10S 90 Long Radius Elbow",
      vendorSku: "",
      quantity: 16,
      uom: "EA",
      unitCost: 7.32,
      unitPrice: null,
      currency: "CAD",
      lineTotal: 117.12,
      source: "table",
      rawText: "Azure invoice item",
      confidence: 0.4,
    },
    {
      description: "304/304L WP A/SA-403W BUTT-WELD 2 10S 90 DEG ELBOW L/R",
      vendorSku: "304LWP10902",
      quantity: 16,
      uom: "EA",
      unitCost: 7.32,
      unitPrice: null,
      currency: "CAD",
      lineTotal: 117.12,
      source: "text",
      rawText: "Pinacle",
      confidence: 0.8,
    },
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.vendorSku, "304LWP10902");
});

test("a 2 inch elbow does not attach to a different catalog product", () => {
  const line = {
    description: "304/304L WP A/SA-403W BUTT-WELD 2 10S 90 DEG ELBOW L/R",
    vendorSku: "304LWP10902",
  };
  assert.equal(
    isCredibleResourceMatch({ name: "6 inch carbon steel 90 elbow", code: "ELBOW-6" }, line),
    false,
  );
  assert.equal(
    isCredibleResourceMatch({ name: "2 10S 90 Long Radius Elbow", code: "ELBOW-2-LR" }, line),
    false,
  );
  assert.equal(
    isCredibleResourceMatch({ name: "2 10S 90 DEG ELBOW L/R", code: "304LWP10902" }, line),
    true,
  );
});

const PINACLE_JAMMED_TEXT = `304LPW102FT1202  10S x 20
8.100      972.00
304/304L A/SA-312 WELDED PIPE
304LPW103FT803  10S x 20
12.100      968.00
304/304L A/SA-312 WELDED PIPE
304LPW1015FT401-1/2  10S x 20
5.300      212.00
304/304L A/SA-312 WELDED PIPE
304LFAWN102EA     20 2  RF WELDNECK CL 150 10S
32.900      658.00
304/304L A/SA-182 FLANGE
304LFAWN103EA     12 3  RF WELDNECK CL 150 10S
55.240      662.88
304/304L A/SA-182 FLANGE
304LFAWN1015EA      8 1-1/2  RF WELDNECK CL150 10S
22.950      183.60
304/304L A/SA-182 FLANGE
304LWP10902EA     16 2  10S 90 DEG ELBOW L/R
7.320      117.12
304/304L WP A/SA-403W BUTT-WELD
304LWS10452EA      8 2  10S 45 DEG ELBOW
7.220      57.76
304/304L A/SA-403 WPS BUTT-WELD SEAMLESS
304LWP10CR200015EA      4 2 x 1-1/2  10S CONC RED
7.360      29.44
304/304L WP A/SA-403W BUTT-WELD
304LWP10903EA      8 3  10S 90 DEG ELBOW L/R
16.230      129.84
304/304L WP A/SA-403W BUTT-WELD
304LWP10T2EA      8 2  10S TEE
12.800      102.40
304/304L WP A/SA-403W BUTT-WELD`;

test("jammed pdf-parse reading order recovers Pinacle lines", () => {
  const lines = extractLinesFromText(PINACLE_JAMMED_TEXT, "CAD", 1);
  assert.equal(lines.length, 11);
  assert.deepEqual(lines.map((line) => [line.vendorSku, line.quantity, line.uom, line.unitCost]), [
    ["304LPW102", 120, "FT", 8.1],
    ["304LPW103", 80, "FT", 12.1],
    ["304LPW1015", 40, "FT", 5.3],
    ["304LFAWN102", 20, "EA", 32.9],
    ["304LFAWN103", 12, "EA", 55.24],
    ["304LFAWN1015", 8, "EA", 22.95],
    ["304LWP10902", 16, "EA", 7.32],
    ["304LWS10452", 8, "EA", 7.22],
    ["304LWP10CR200015", 4, "EA", 7.36],
    ["304LWP10903", 8, "EA", 16.23],
    ["304LWP10T2", 8, "EA", 12.8],
  ]);
});

test("the attached Pinacle quotation PDF extracts eleven cost lines", async () => {
  const { createPdfParser } = await import("@bidwright/ingestion");
  const pdfPath = "/Users/braedonsaunders/.bb/thread-storage/thr_i2qrj8ac6e/Attachments/Quote_T390411_RASSAUN_20260831_15_23.pdf";
  let buffer: Buffer;
  try {
    buffer = await readFile(pdfPath);
  } catch {
    return;
  }
  const doc = await createPdfParser({ provider: "local", options: { tableExtractionEnabled: true, outputFormat: "text" } })
    .parse(buffer, "Quote_T390411_RASSAUN_20260831_15_23.pdf");
  const lines = extractVendorEvidenceLines(doc, () => "CAD");
  assert.equal(lines.length, 11, lines.map((line) => `${line.vendorSku}:${line.quantity}${line.uom}`).join(", "));
  assert.deepEqual(
    lines.map((line) => [line.vendorSku, line.quantity, line.uom, Number(line.unitCost.toFixed(2))]),
    [
      ["304LPW102", 120, "FT", 8.1],
      ["304LPW103", 80, "FT", 12.1],
      ["304LPW1015", 40, "FT", 5.3],
      ["304LFAWN102", 20, "EA", 32.9],
      ["304LFAWN103", 12, "EA", 55.24],
      ["304LFAWN1015", 8, "EA", 22.95],
      ["304LWP10902", 16, "EA", 7.32],
      ["304LWS10452", 8, "EA", 7.22],
      ["304LWP10CR200015", 4, "EA", 7.36],
      ["304LWP10903", 8, "EA", 16.23],
      ["304LWP10T2", 8, "EA", 12.8],
    ],
  );
});
