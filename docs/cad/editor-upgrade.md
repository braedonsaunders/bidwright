# CAD editor upgrade

The embedded shell now uses MLightCAD viewer **1.7.4** (previously 1.5.6) and data-model **1.15.1** (previously 1.9.14). The viewer source matches the published 1.7.4 source/tag `17cf21a4195ce77a41cc983bc9a22c9e20c14b06`; core packages follow the 1.15.1 data-model release. Upstream licence headers are retained.

The old fork predates an identifiable upstream source base. Packages were replaced with the released upstream source, then the BidWright shell and these required fixes were reapplied:

- Document bridge, original file routing, theme backgrounds and DXF capture cache for automatic/manual save and exit flush.
- Local DWG parser worker and WASM; upstream's removed DXF worker/runtime options are no longer used.
- TypeScript typed-array ownership fixes and build configuration for the current package graph. The obsolete standalone dxf-json-converter package is excluded from the build chain.
- Native viewport positioning under the shell mode bar and safe fitting before a layout view exists.
- Entity batch accounting for incremental updates.
- Final DXF HANDSEED allocation for both ASCII and binary output, and version-gated legacy DXF viewport/header/MLEADERSTYLE serialization for the R2000 writer.
- Legacy DWG dictionary byte decoding and application XRECORD import so the piping model survives DWG reopen.

The workspace now requires Node 24 and pnpm 10.33.4. Install and build:

```sh
pnpm --dir apps/cad-editor install --frozen-lockfile
pnpm --dir apps/cad-editor run build:bidwright
node scripts/cad-editor/sync-built-assets.mjs
```

The web Docker image serves checked-in `apps/web/public/cad-editor`; syncing is mandatory after editor changes. CI separately builds the CAD workspace, checks legacy DXF/DWG metadata, and runs browser routing/export/reopen tests before publishing images. Root focused tests cover measured cut calculations, specification/heat identity, PCF import/export, grid projection, validation and DWG normalization.

Browser tests use the repository-pinned Playwright version. Locally the default channel is installed Chrome; CI installs the pinned Chromium browser. Close test browsers and temporary preview services after verification.
