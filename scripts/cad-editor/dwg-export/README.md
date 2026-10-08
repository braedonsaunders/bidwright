# Native DWG writer

The shipped worker writes AutoCAD 2000 (`AC1015`) DWG from the editor's ASCII DXF. It uses GNU LibreDWG 0.14 under GPL-3.0-or-later. Modern DWG writing is experimental in LibreDWG, so this writer deliberately targets R2000. Conversion errors stop the download; DXF remains available.

Corresponding source: https://github.com/LibreDWG/libredwg/releases/download/0.14/libredwg-0.14.tar.xz (SHA256 pinned in the build script). The complete library source, licence, and headers are in that source release; our wrapper and exact compiler invocation are in `build-in-container.sh`.

Rebuild with Docker:

```sh
mkdir -p /tmp/bidwright-dwg-build
cp scripts/cad-editor/dwg-export/build-in-container.sh /tmp/bidwright-dwg-build/build.sh
docker run --rm --cpus=2 --memory=4g -v /tmp/bidwright-dwg-build:/build emscripten/emsdk:4.0.23@sha256:86537645c51e44899812d29820ee3b64b96c321ebb2aba4416a04ceeb1bcde62 sh /build/build.sh
cp /tmp/bidwright-dwg-build/dist/* apps/cad-editor/packages/bidwright-cad-editor/public/dwg-export/
```

`worker.js` is the BidWright integration and remains alongside those outputs. `COPYING` accompanies the distributed WASM. Each conversion uses a dedicated worker, with a 256 MB WASM memory cap and a 60 second timeout; the worker is terminated on completion or failure.
