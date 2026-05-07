# Agent Orchestration Eval Harness

This harness is for live, agentic evaluation of Bidwright quote intake runs.
It is not a deterministic pass/fail test suite. The script uploads packages,
starts the agent, records every chat/tool/status event, and builds an observer
dossier so Codex can watch the run and make real-time quality decisions.

## Run

```bash
BIDWRIGHT_API_URL=http://localhost:4001 \
BIDWRIGHT_EMAIL=you@example.com \
BIDWRIGHT_PASSWORD='...' \
pnpm eval:agent -- --cases ./eval-cases --out ./.bidwright/evals
```

Against prod, use the prod API URL and either login env vars or
`BIDWRIGHT_AUTH_TOKEN`.

```bash
BIDWRIGHT_API_URL=https://your-api-host \
BIDWRIGHT_AUTH_TOKEN='...' \
pnpm eval:agent -- ./eval-cases/package-a.zip
```

## Live Monitoring Workflow

For each case the harness writes:

- `observer.md`: live human/Codex dossier with ingestion updates, event deltas,
  tool calls/results, thinking snippets, rolling review briefs, and a final
  decision slot.
- `events.ndjson`: compact raw event stream for replay or deeper inspection.
- `live-state.json`: latest monitor state for quick polling.
- `workspace.json`: final workspace snapshot.
- `report.md` / `report.json`: telemetry summary.

The intended loop is:

1. Start the harness in a terminal.
2. Watch the terminal and `observer.md` while the agent runs.
3. When something looks wrong, stop the run, inspect tool payloads/logs, patch
   orchestration or tool contracts, and rerun the same case.
4. Use follow-up questions to test manual quote flows after document upload.
5. Keep the eval cases and observer notes as a benchmark corpus.

The numeric bands are only smoke signals. They help point attention at tool
failures, shallow document use, missing strategy stages, or weak evidence, but
the real decision is made by the live reviewer.

## Relentless Local Loops

Run the same case many times before shipping orchestration changes:

```bash
pnpm eval:agent -- --cases ./eval-cases --repeat 12 --review-cadence-seconds 30
```

For large packages, prepare/extract once, then rerun only the agentic estimating
process against copied projects:

```bash
pnpm eval:agent -- ./eval-cases/package.zip --prepare-only
# note the prepared project id after extraction, then:
pnpm eval:agent -- --project-id project_... --repeat 12 --review-cadence-seconds 30
```

By default `--project-id` copies the prepared project for each attempt. This
keeps the already-extracted documents and gives each agent run a fresh quote
workspace. Use `--no-copy-project-per-run` only when intentionally testing
follow-up behavior in the same quote.

For each repeated package, inspect `relentless-loop.md`. It groups repeated
runs by package and shows recurring journey shapes, repeated gaps, estimate
total drift, and observer links. The goal is not to make a number green; it is
to find the first point where the agent stops behaving like a real estimator.

## Awarded Human Quote References

Use `--human-quote` to attach real awarded/completed quote PDFs as calibration
references. These are not deterministic gates and they are not a quality
ceiling; they give the live reviewer a grounded comparison for scope coverage,
category mix, total drift, and missing awarded-job line-item signals.

```bash
pnpm eval:agent -- --project-id project_... \
  --human-quote "/absolute/path/Fabrication.pdf" \
  --human-quote "/absolute/path/Installation.pdf"
```

The harness extracts quote numbers, line items, category totals, worksheet
totals, combined awarded-reference total, agent/reference ratio, and matched or
missing awarded-job scope signals into `report.md`, `report.json`, and
`summary.json`.

The harness traces a human-estimator journey across phases:

- orientation on workspace and strategy
- document inventory and spec reading
- drawing deep-read/zoom/symbol inspection
- takeoff and quantity linkage
- estimator book and dataset lookup
- labour-unit/productivity lookup
- pricing basis selection
- worksheet build
- reconcile and final review

## Sidecar Intake Metadata

For `package.zip`, add `package.eval.json` beside it:

```json
{
  "name": "Pump station RFQ",
  "projectName": "Pump station RFQ Eval",
  "clientName": "Example Client",
  "location": "Example City",
  "scope": "Budget turnkey mechanical estimate"
}
```

This metadata should match what a human would type into the intake form. Use
`--human-quote` for awarded quote calibration after the agent run. Keep hidden
expected answers, project-specific probes, and human quote details out of normal
UI-equivalent intake cases.

## Manual Quote Question Mode

To simulate a manually created quote with documents uploaded piecemeal, run a
package and ask a normal drawer question instead of full intake:

```bash
pnpm eval:agent -- --mode manual-question --question "What is this quote missing?" ./eval-cases/package.zip
```

## Labor Unit Tree Navigation Loop

Use the limited labor tree harness when iterating specifically on how the agent
searches and browses labor productivity libraries. It exercises only
`listLaborUnitTree` and `listLaborUnits`, writes a compact tool trace, and
records review observations rather than production gates.

```bash
pnpm eval:labor-tree
pnpm eval:labor-tree -- --q "equipment setting" --q "carbon steel pipe installation"
pnpm eval:labor-tree -- --beam-width 7 --max-unit-paths 8 --variant-count 6
```

Outputs go to `.bidwright/evals/labor-tree/latest/`:

- `labor-tree-harness.md`: human-readable probe report
- `labor-tree-harness.json`: structured results
- `tool-trace.ndjson`: every simulated tool call and result summary

The harness uses a beam-style tree walk instead of exhaustively exploding every
branch. It also records search diagnostics: term hit counts, full-slice
co-occurrence counts, and narrow follow-up probes so the live reviewer can see
when a result is an exact-looking labor basis versus an analog candidate.

You can also pass a case file:

```json
[
  {
    "name": "Tank install language",
    "query": "FRP tank installation labor",
    "expectedTerms": ["tank", "vessel"]
  }
]
```
