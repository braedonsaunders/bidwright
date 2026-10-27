# Third-Party Notices

Bidwright includes source code and compiled artifacts from the open-source projects below. Each keeps its own license. The upstream license texts are kept alongside the code in this repository.

| Component | Where it lives in Bidwright | Upstream | License |
| --- | --- | --- | --- |
| CAD-Viewer by mlightcad | `apps/cad-editor` (vendored source, with Bidwright's `bidwright-cad-editor` package added) | [mlightcad/cad-viewer](https://github.com/mlightcad/cad-viewer) | MIT, see [`apps/cad-editor/LICENSE`](apps/cad-editor/LICENSE) |
| Chili3D by xiangechen | `apps/model-editor` (forked and modified source; also the `fonts/fzhei.json` typeface) | [xiangechen/chili3d](https://github.com/xiangechen/chili3d) | AGPL-3.0, see [`apps/model-editor/LICENSE`](apps/model-editor/LICENSE) |
| Open CASCADE Technology V8.0.1 | Compiled into `apps/model-editor/packages/wasm/lib/chili-wasm.wasm` | [Open-Cascade-SAS/OCCT](https://github.com/Open-Cascade-SAS/OCCT) | LGPL-2.1 with the Open CASCADE exception |
| GNU LibreDWG 0.14 | `apps/cad-editor/packages/bidwright-cad-editor/public/dwg-export` (source tarball and the `dwg-export.wasm` built from it) | [GNU LibreDWG](https://www.gnu.org/software/libredwg/) | GPL-3.0-or-later, see [`COPYING`](apps/cad-editor/packages/bidwright-cad-editor/public/dwg-export/COPYING) |

The bundles committed under `apps/web/public/cad-editor`, `apps/web/public/model-editor` and `apps/web/public/spoolyard` are build output. They come from the components above and from [Spoolyard](https://github.com/braedonsaunders/spoolyard), and carry the same licenses as their sources.

Package dependencies installed through npm/pnpm are not listed here. Their licenses ship with each package.
