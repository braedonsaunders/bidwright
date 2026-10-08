# @mlightcad/emf-converter

Source fork of [`emf-converter@2.0.2`](https://www.npmjs.com/package/emf-converter)
(Apache-2.0, [ChristopherVR/emf-converter](https://github.com/ChristopherVR/emf-converter))
used by `@mlightcad/data-model` to rasterize OLE2FRAME WMF/EMF previews.

Upstream tag: **`v2.0.2`** (`460b4fc`).

## Fork changes (vs upstream 2.0.2)

1. **`EMR_EXTSELECTCLIPRGN`** (`src/emf-gdi-draw-text-bitmap.ts`) — clip rects
   use device/page space instead of the GDI world transform, so Excel OLE
   `ExtTextOut` glyphs are not clipped away.
2. **`EMR_EXTCREATEFONTINDIRECTW`** (`src/emf-gdi-object-handlers.ts`) —
   `LOGFONTW.lfFaceName` is read at byte offset **32** (not 28), matching the
   Windows structure so CJK face remapping works.

## Install

```bash
pnpm add @mlightcad/emf-converter
```

## API

Same public API as upstream 2.0.2:

```ts
import {
  convertEmfToDataUrl,
  convertWmfToDataUrl
} from '@mlightcad/emf-converter'

const pngDataUrl = await convertEmfToDataUrl(arrayBuffer, {
  maxWidth: 4096,
  maxHeight: 4096,
  dpiScale: 1,
  fontFamilyMap: { simsun: '"Microsoft YaHei", sans-serif' }
})
```

`@mlightcad/data-model` statically imports this package and inlines it into
its published CJS bundle.

## Develop

```bash
pnpm --filter @mlightcad/emf-converter build
pnpm --filter @mlightcad/emf-converter test
```

## License

Apache-2.0 — see [LICENSE](./LICENSE) and [NOTICE.md](./NOTICE.md).
