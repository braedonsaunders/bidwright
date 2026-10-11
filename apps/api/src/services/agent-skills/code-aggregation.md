---
name: code-aggregation
description: Aggregate scoped API data in code with the workspace bw client.
---

Run `.bidwright/bin/bw` (or `node .bidwright/bin/bw.mjs`) for JSON reads and explicit API writes.
It uses BIDWRIGHT_API_URL, BIDWRIGHT_AUTH_TOKEN and BIDWRIGHT_PROJECT_ID from the runtime environment, like MCP. No credentials belong in scripts or outputs.
Examples:
```sh
.bidwright/bin/bw overview
.bidwright/bin/bw elements MODEL_ID --all
.bidwright/bin/bw pickups
.bidwright/bin/bw items
.bidwright/bin/bw datasets
.bidwright/bin/bw rows DATASET_ID --all
.bidwright/bin/bw get /projects/PROJECT_ID/workspace
.bidwright/bin/bw post /projects/PROJECT_ID/worksheets '{"name":"Installation"}'
```
`elements` and `rows` accept `--limit N`, `--offset N`, `--all`; other helpers read their API's full response once. `items` flattens the workspace's worksheet items.
`--all` returns one JSON array across pages. Generic `get` returns the API response unchanged and accepts query parameters in the path.
The client refuses absolute URLs and redirects so authentication stays on the configured API host. Project paths use the current project; the API applies the same authenticated organization permissions as MCP.
POST is an explicit write and is unavailable in Q&A/review mode. Use describeTools/invokeTool for discoverable schemas; all changes go through API services.
Aggregate by stable IDs with explicit units. Deduplicate overlapping element groups and keep gross/net and authored/geometric bases distinct.
This is a launch snapshot: `.bidwright/source-overview.json`. `bw overview` or getSourceOverview refreshes the live facts.

`saveSourceQuantityTakeoff` records authored BOM/schedule/table quantities as visible takeoff pickups.
Supply quantity, unit, label, documentId (`file-<nodeId>` for a FileNode) and sourceRefs (sheet/row/page/cell/text).
An optional linkToItemId, quantityField and explicit conversion multiplier connect the pickup to a worksheet quantity.
A returned linkError means the pickup was saved but the worksheet link failed; use its id instead of duplicating the pickup.

## Save several BOM lines, then connect them to rows

Each call saves one authored line. For example, with actual document and worksheet IDs:
```js
const lines = [
  { documentId, quantity: 317, unit: "LF", label: "3-inch pipe", sourceRefs: [{ sheet: "BOM", row: 6 }] },
  { documentId, quantity: 52.58, unit: "LF", label: "2-inch pipe", sourceRefs: [{ sheet: "BOM", row: 7 }] },
  { documentId, quantity: 43, unit: "EA", label: "Valves", sourceRefs: [{ sheet: "BOM", row: 8 }] },
];
for (const line of lines) await invokeTool({ name: "saveSourceQuantityTakeoff", args: line });
// After creating the corresponding installed-quantity rows, reuse the same inputs.
for (let i = 0; i < lines.length; i++) {
  const result = await invokeTool({ name: "saveSourceQuantityTakeoff", args: {
    ...lines[i], linkToItemId: worksheetItemIds[i], quantityField: "value", multiplier: 1,
  }});
  // result contains the existing pickup and link, or a linkError to inspect.
}
```
The repeated source facts reuse the pickup; this does not double-count it. The multiplier converts source units to the target row's units. A pipe-length pickup can link to an installed LF row; it is not automatically a labour-hour or purchased-pack quantity.

## Installed quantities, purchasing and effort

A quantity record can describe installed work (for example 317 LF of pipe), while a procurement row describes stock purchased (for example seventeen 20-ft lengths = 340 LF). The difference can be recorded as cutting waste or surplus, with its calculation. A supplier lot is a priced commercial package, not an installed count.

Shop and field work can have separate person-hour calculations: 20 joints × 2 shop person-hours/joint, plus 5 closures × 3 field person-hours/joint. Crew size describes staffing; multiplying an already person-hour rate by crew size would count effort twice. An unquoted allowance can carry its amount, covered scope and uncertainty separately from measured quantities and vendor prices. Source facts and any alternate or provisional quantities can remain visible side by side.

FileNode text/spreadsheet reads resolve existing SourceDocument links without ingesting. An unextracted file is reported as such; `promoteSourceDocument` is the explicit write that ingests a supported source and can incur extraction costs. Archives and model files use their dedicated tools.
