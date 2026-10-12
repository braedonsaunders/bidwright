# Labour retrieval and indexing

`listLaborUnits`, the labour tree search and `matchLaborUnits` rank the source row and selected column above shared headers. Size/schedule contradictions reduce rank. Synonyms include hydrotest/hydrostatic testing. Numeric dataset rows retain their dimensions; stored names are unchanged.

Weak breakdown matches or mismatched output units include examples of the matching tables' operations and units. They are examples from up to 100 rows per matching table, not a full catalogue or a claim that those tasks cover an assembly.

## Regression probe

Run from the repository root:

```sh
pnpm exec tsx --test apps/api/src/services/labor-search.test.ts apps/api/src/services/labor-vector-index.test.ts apps/api/src/services/labor-unit-matching.test.ts apps/api/src/services/indexed-search.test.ts
```

The fixture contains 36 captured library rows, including painting/connector false positives. An additional synthetic erection row verifies explicit erection outranks coating. The captured generic Structural row (11.33 h/TON) is not relabelled as erection. Tests cover shop fillet weld FT, 3-inch butt weld/stainless candidates, 3-inch lug butterfly valves and hydrotesting. These are reranking regressions, not a measurement of deployed whole-library recall.

## Incremental semantic index

The existing OpenRouter configuration supplies the provider/model/credentials. The job uses the existing org-scoped `vector_records` store; no schema changes. Index reads never create embeddings of units. Search embeds a query only when a matching tenant/model labour index exists, caches that query for 15 minutes and falls back to lexical retrieval on a provider/storage failure. Book search excludes labour vectors before its result limit.

```sh
BIDWRIGHT_API_URL=https://your-host/proxy \
BIDWRIGHT_AUTH_TOKEN_FILE=/path/to/eval.env \
node scripts/retrieval/index-labor-units.mjs --checkpoint /outside/repo/labor-dry-run.json
```

The authenticated `POST /api/labor-units/index` endpoint processes at most 100 units per page. It defaults to `dryRun:true`. Each page reports scanned/unchanged/pending units and an approximate token count. The CLI preserves any URL prefix and writes an atomic checkpoint. It accepts the harness KEY=value token file and does not print credentials.

An authorized indexing pass uses `--execute` and a different checkpoint. Re-running a pass with `--restart` rescans for changes; content hashes skip unchanged text. Interrupted pages can be retried. Model/provider/dimension changes use separate index identities. Storage dimensions are checked before an embedding request. Old model records can remain in storage; only records for the configured model participate in labour searches. Source units are rehydrated through the normal tenant/filter permissions, so removed or inaccessible units are not returned.

## Initial cost estimate (2026-10-12)

A read-only sample of 883 units (up to 100 from each of 11 libraries), weighted by each library's unit count, projects 5,778,145 tokens for 52,109 units. Text is task + library/path + context, capped at 3,000 characters. The estimate uses UTF-8 bytes / 4; it is neither a random sample nor the provider tokenizer's billed count.

At [OpenRouter's text-embedding-3-small rate](https://openrouter.ai/openai/text-embedding-3-small) of $0.02/million tokens, that is about **$0.12**, excluding retries/query embeddings and any account funding fees. A 2× allowance is about $0.24. A full dry-run can measure the exact input byte count after deployment. No bulk indexing was run while preparing this change; execution awaits owner approval.
