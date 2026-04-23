# BidWright Model Editor Agent Notes

This is BidWright-owned source for the embedded 3D model editor and takeoff workspace.

## Commands

```bash
npm ci
npm run build
npm run test
npm run check
```

From the BidWright root:

```bash
pnpm run model-editor:build
```

## Architecture

The editor remains a TypeScript/npm workspace under `apps/model-editor/packages/*`. Internal packages still use the original `@chili3d/*` module names until a larger namespace refactor is worthwhile; those names are implementation details, not app branding.

## Rules

- Treat this as a one-way fork. Do not add vendor update scripts.
- Keep the first screen embedded in BidWright, not a standalone welcome page.
- Preserve upstream license notices in existing source files.
- Run the root sync script after editor builds so web assets land in `apps/web/public/model-editor`.
