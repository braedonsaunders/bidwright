# @mlightcad/dxf-json-converter

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![npm version](https://img.shields.io/npm/v/@mlightcad/dxf-json-converter.svg)](https://www.npmjs.com/package/@mlightcad/dxf-json-converter)

The `dxf-json-converter` package provides a DXF file converter for the RealDWG-Web ecosystem, enabling reading and conversion of DXF files into the AutoCAD-like drawing database structure. It is based on [@mlightcad/dxf-json](https://www.npmjs.com/package/@mlightcad/dxf-json).

## Overview

This package implements a DXF file converter compatible with the RealDWG-Web data model. It allows you to register DXF file support in your application and convert DXF files into the in-memory drawing database.

DXF parsing is provided through a dedicated Web Worker bundle (`dxf-parser-worker.js`). **This converter is intended for Web Worker use only.** That restriction is not because parsing cannot run on the main thread in principle; it is a deliberate licensing choice. `@mlightcad/dxf-json` is GPL-3.0, and loading it in a separate worker bundle helps keep copyleft parser code apart from the main MIT-licensed application so license obligations are easier to manage.

## Key Features

- **DXF File Support**: Read and convert DXF files to the drawing database
- **Worker-based Parsing**: Required by design for GPL license isolation
- **Integration**: Designed to work with the RealDWG-Web data model and converter manager

## Installation

```bash
npm install @mlightcad/dxf-json-converter
```

> **Peer dependencies:**
> - `@mlightcad/data-model`

## Usage Example

```typescript
import { AcDbDatabaseConverterManager, AcDbFileType } from '@mlightcad/data-model';
import { AcDbDxfConverter } from '@mlightcad/dxf-json-converter';

const dxfConverter = new AcDbDxfConverter({
  useWorker: true,
  parserWorkerUrl: './assets/dxf-parser-worker.js'
});
AcDbDatabaseConverterManager.instance.register(AcDbFileType.DXF, dxfConverter);
```

Deploy `dxf-parser-worker.js` from this package's `dist/` folder to a public URL accessible by your application.

## API

- **AcDbDxfConverter**: Main converter class for DXF files (extends `AcDbDatabaseConverter`)

## Dependencies

- **@mlightcad/data-model**: Drawing database and entity definitions
- **@mlightcad/dxf-json**: DXF file parser (GPL-3.0), loaded in the worker bundle by design for license isolation

## API Documentation

For detailed API documentation, visit the [RealDWG-Web documentation](https://mlight-lee.github.io/realdwg-web/).

## Contributing

This package is part of the RealDWG-Web monorepo. Please refer to the main project README for contribution guidelines.
