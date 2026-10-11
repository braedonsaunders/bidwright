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
