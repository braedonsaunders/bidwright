#!/usr/bin/env node
// Incremental API job. Default is a provider-free dry run; --execute embeds changed units.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if (args.includes('--help')) {
  console.log(`BIDWRIGHT_API_URL=https://host/proxy BIDWRIGHT_AUTH_TOKEN_FILE=/path/to/eval.env
  node scripts/retrieval/index-labor-units.mjs [--execute] [--checkpoint /outside/repo/job.json] [--restart]

Default: provider-free dry run, 100 units/page. Requires the deployed labour-vector migration.
--execute embeds changed units and purges obsolete model/dimension/version records.
Shared libraries are embedded once; private libraries use their owner's namespace.
--checkpoint records progress atomically; rerun the same command to resume.
Use separate checkpoints for dry-run/execute. --restart rescans all units for edits.
Token files accept a raw token or BIDWRIGHT_EVAL_TOKEN/BIDWRIGHT_AUTH_TOKEN=... .
Counts/tokens are cumulative for this pass; token counts use UTF-8 bytes / 4,
not provider-billed usage. Neither credentials nor source text are printed.`);
  process.exit(0);
}
const base = process.env.BIDWRIGHT_API_URL;
if (!base || !process.env.BIDWRIGHT_AUTH_TOKEN_FILE) throw new Error('BIDWRIGHT_API_URL and BIDWRIGHT_AUTH_TOKEN_FILE are required');
const raw = (await readFile(process.env.BIDWRIGHT_AUTH_TOKEN_FILE, 'utf8')).trim();
const token = (raw.match(/^(?:BIDWRIGHT_EVAL_TOKEN|BIDWRIGHT_AUTH_TOKEN)=(.*)$/m)?.[1] ?? raw).trim().replace(/^(['"])(.*)\1$/, '$2');
const url = new URL(base.replace(/\/+$/, '') + '/api/labor-units/index');
const execute = args.includes('--execute');
const checkpoint = value('--checkpoint') ? resolve(value('--checkpoint')) : null;
let state = { endpoint: url.href, execute, cursor: null, scanned: 0, pending: 0, embedded: 0, saved: 0, purged: 0, estimatedTokens: 0, complete: false };
if (checkpoint && !args.includes('--restart')) {
  try { state = JSON.parse(await readFile(checkpoint, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (state.endpoint !== url.href || state.execute !== execute) throw new Error('Checkpoint endpoint/mode differs; use a separate checkpoint or --restart');
}
while (!state.complete) {
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cursor: state.cursor ?? undefined, limit: 100, dryRun: !execute }) });
  if (!response.ok) throw new Error(`Index API returned HTTP ${response.status}; checkpoint remains on the preceding page`);
  const page = await response.json();
  if (!page.enabled) throw new Error(page.fact ?? 'Embedding provider unavailable');
  if (state.model && (state.model !== page.model || state.dimensions !== page.dimensions)) throw new Error('Embedding configuration changed; restart this pass');
  for (const key of ['scanned', 'pending', 'embedded', 'saved', 'purged', 'estimatedTokens']) state[key] = (state[key] ?? 0) + (page[key] ?? 0);
  Object.assign(state, { model: page.model, dimensions: page.dimensions, cursor: page.nextCursor, complete: !page.nextCursor });
  if (checkpoint) { await writeFile(checkpoint + '.tmp', JSON.stringify(state, null, 2), { mode: 0o600 }); await rename(checkpoint + '.tmp', checkpoint); }
  console.log(JSON.stringify(state));
}
