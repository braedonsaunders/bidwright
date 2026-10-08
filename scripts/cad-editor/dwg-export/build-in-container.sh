#!/bin/sh
set -eu
apt-get update -qq
apt-get install -y -qq pkg-config > /build/packages.log 2>&1
cd /build
curl -L --fail --silent https://github.com/LibreDWG/libredwg/releases/download/0.14/libredwg-0.14.tar.xz -o libredwg-0.14.tar.xz
printf '%s  %s\n' '62ebb73b984f865960f20ed26619ea5f8789d5e3fd088fa40a2598384da81275' 'libredwg-0.14.tar.xz' | sha256sum -c -
sha256sum libredwg-0.14.tar.xz > source.sha256
tar -xf libredwg-0.14.tar.xz
cd libredwg-0.14
emconfigure ./configure --disable-shared --enable-static --disable-bindings --disable-docs --disable-json CFLAGS='-O2' > /build/configure.log 2>&1
emmake make -C src -j2 libredwg.la > /build/compile.log 2>&1
cat > /build/export.c <<'C'
#include <string.h>
#include "dwg.h"
int bw_convert(void) {
  Dwg_Data dwg;
  memset(&dwg, 0, sizeof(dwg));
  dwg.opts=1;
  int error=dxf_read_file("/input.dxf", &dwg);
  if (error >= DWG_ERR_CRITICAL) { dwg_free(&dwg); return error; }
  dwg.header.version=R_2000;
  error=dwg_write_file("/output.dwg", &dwg);
  dwg_free(&dwg);
  return error;
}
C
mkdir -p /build/dist
emcc -O2 -Iinclude -Isrc /build/export.c src/.libs/libredwg.a -lm -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=268435456 -sFILESYSTEM=1 -sEXPORTED_FUNCTIONS='["_bw_convert"]' -sEXPORTED_RUNTIME_METHODS='["FS","ccall"]' -o /build/dist/dwg-export.js
cp COPYING /build/dist/COPYING
cat /build/source.sha256
ls -lh /build/dist
