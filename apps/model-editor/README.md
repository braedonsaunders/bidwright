# BidWright Model Editor

BidWright's first-party browser CAD editor and 3D takeoff workspace.

This codebase began as a fork of the open-source Chili3D project, but it now lives inside BidWright as application source rather than a vendor package. It is built, tested, modified, and released with BidWright.

## Development

```bash
npm ci
npm run dev
npm run build
```

From the BidWright repository root:

```bash
pnpm run model-editor:install
pnpm run model-editor:build
```

The production build is copied to `apps/web/public/model-editor` and served by the web app at `/model-editor/index.html`.

## WebAssembly

The geometric kernel is OpenCascade compiled to WebAssembly.

```bash
npm run setup:wasm
npm run build:wasm
```

## Notes

- Keep the editor embedded-first: the BidWright file browser and 2D/3D takeoff surfaces are the host experience.
- Do not add an upstream-update workflow. This is a one-way fork.
- Preserve upstream license notices in copied source files.
