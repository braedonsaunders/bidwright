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

## Sidecar Expectations

For `package.zip`, add `package.eval.json` beside it:

```json
{
  "name": "Pump station RFQ",
  "scope": "Budget turnkey mechanical estimate",
  "expectedDocumentNames": ["spec", "drawing"],
  "expectedKeywords": ["pump", "spool"],
  "followUpQuestions": [
    "What documents did you rely on and what scope is most uncertain?"
  ]
}
```

Expectations are used as extra review signals, not hard gates.

## Manual Quote Question Mode

To simulate a manually created quote with documents uploaded piecemeal, run a
package and ask a normal drawer question instead of full intake:

```bash
pnpm eval:agent -- --mode manual-question --question "What is this quote missing?" ./eval-cases/package.zip
```
