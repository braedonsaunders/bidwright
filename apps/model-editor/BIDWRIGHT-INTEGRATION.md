# BidWright Model Editor

This directory is BidWright-owned model editor source. It began as a Chili3D fork, but it is no longer treated as a vendored upstream package or an automatically updateable dependency.

Fork lineage: https://github.com/xiangechen/chili3d

Current integration shape:

- Source lives here for ongoing BidWright modifications.
- Built web assets are served by the Next.js app from `apps/web/public/model-editor`.
- File browser and 3D takeoff embed the editor at `/model-editor/index.html?url=<model-url>`.
- The embedded shell launches directly into a BidWright model workspace, without the upstream welcome page, social links, WeChat action, or visible Chili branding.
- The HTML removes upstream analytics and uses BidWright metadata.

Useful commands from the repository root:

```powershell
pnpm run model-editor:install
pnpm run model-editor:build
```

Licensing:

- Chili3D TypeScript source is AGPL-3.0 under the upstream license.
- Chili3D C++/WASM pieces follow the upstream C++ licensing notes.
- BidWright is open source, so keep this integration source-available and preserve upstream notices.
