# DWG writer: source and build

`dwg-export.wasm` and `dwg-export.js` are GNU LibreDWG 0.14 compiled to WebAssembly with Emscripten, plus a
small wrapper. LibreDWG is free software under the GNU General Public License, version 3 or (at your option) any
later version; the licence text is `COPYING` in this folder. You may copy, modify and redistribute this writer
under those terms. It runs as a separate program in its own Web Worker: Spoolyard gives it a DXF file and
reads back a DWG file.

## Corresponding source

| Part | Source |
| --- | --- |
| GNU LibreDWG 0.14 | Release tarball `libredwg-0.14.tar.xz`, SHA-256 `62ebb73b984f865960f20ed26619ea5f8789d5e3fd088fa40a2598384da81275`, from <https://github.com/LibreDWG/libredwg/releases/download/0.14/libredwg-0.14.tar.xz> or <https://ftp.gnu.org/gnu/libredwg/libredwg-0.14.tar.xz>. Git tag `0.14` (commit `d9468ae948b8f07a08efa756c19f8916052358c0`) at <https://github.com/LibreDWG/libredwg> and <https://git.savannah.gnu.org/git/libredwg.git>. Unmodified. |
| Wrapper (`bw_convert`) and build recipe | [`scripts/dwg-export/build-in-container.sh`](https://github.com/braedonsaunders/spoolyard/blob/main/scripts/dwg-export/build-in-container.sh) in the Spoolyard source: the wrapper's C source, the configure options and the exact `emcc` command. |
| Build driver | [`scripts/build-dwg-export.sh`](https://github.com/braedonsaunders/spoolyard/blob/main/scripts/build-dwg-export.sh) |
| `worker.js`, `dxf-compat.js` | Spoolyard's own JavaScript, shipped as source in this folder. |

`dwg-export.js` is the loader Emscripten generates (Emscripten's runtime is MIT / University of Illinois
licensed).

Should those addresses stop serving the release, ask at <https://github.com/braedonsaunders/spoolyard/issues>
for `libredwg-0.14.tar.xz` and it will be provided at no charge.

## Build

The build runs in the Emscripten SDK container
`emscripten/emsdk:4.0.23@sha256:86537645c51e44899812d29820ee3b64b96c321ebb2aba4416a04ceeb1bcde62`
(emcc 4.0.23, commit `7a5d93b50f6a3a35e85a0d2fc9e667b8498e6aed`):

1. Download `libredwg-0.14.tar.xz` and check its SHA-256.
2. `emconfigure ./configure --disable-shared --enable-static --disable-bindings --disable-docs --disable-json CFLAGS='-O2'`
3. `emmake make -C src libredwg.la`
4. Compile the wrapper and link it with `src/.libs/libredwg.a`:
   `emcc -O2 -Iinclude -Isrc export.c src/.libs/libredwg.a -lm -sMODULARIZE=1 -sEXPORT_ES6=1
   -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=268435456
   -sFILESYSTEM=1 -sEXPORTED_FUNCTIONS='["_bw_convert"]' -sEXPORTED_RUNTIME_METHODS='["FS","ccall"]'
   -o dwg-export.js`
5. Copy LibreDWG's `COPYING` beside the outputs.

From a Spoolyard checkout with Docker:

```sh
scripts/build-dwg-export.sh            # build and compare with the files in this folder
scripts/build-dwg-export.sh --install  # build and replace them
```

The build is reproducible: it gives byte-for-byte the files shipped here.

| File | SHA-256 |
| --- | --- |
| `dwg-export.wasm` | `171977a274a23600a5ff0a90b90c649e4335e65cd70aee3d0006b6ff680de1cb` |
| `dwg-export.js` | `0c3bd2e449e9227ffd3770068e26178185649386d5a632f32001c7b8a1229c0f` |
| `COPYING` | `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903` |

## Reading the DWG back

LibreDWG's own reader is the check used: `dwg2dxf` of the same release (0.14, built natively from the tarball above)
reads Spoolyard's drawing and material sheets back with the DXF's record count of every type (each table, block,
HATCH, INSERT and TEXT).
It does print `Warning: Skip HATCH common handles due to short handle stream` once per HATCH. That warning comes from
the reader, not the file: in an R2000 entity the common handles (extension dictionary, previous and next entity,
layer) are read with the entity's common data, before its own fields, and the HATCH reader then checks again for at
least one byte of handle stream left over. A solid fill with no associative boundary objects has none left (its
handle stream ends with its layer handle), so the reader warns and has already read everything; each object's CRC
checks. Writing the hatches differently (associative boundaries, reactors) would only add handles the drawing does not
have. LibreDWG 0.13.4's reader also reports `bit_read_* buffer overflow` at the end of the file and one handle not
found; 0.14's reads the same files without either.
