# @mlightcad/libredwg-converter

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![npm version](https://img.shields.io/npm/v/@mlightcad/libredwg-converter.svg)](https://www.npmjs.com/package/@mlightcad/libredwg-converter)

The `libredwg-converter` package provides a DWG file converter for the RealDWG-Web ecosystem, enabling reading and conversion of DWG files into the AutoCAD-like drawing database structure. It is based on the [LibreDWG](https://www.gnu.org/software/libredwg/) library compiled to WebAssembly.

## Overview

This package implements a DWG file converter compatible with the RealDWG-Web data model. It allows you to register DWG file support in your application and convert DWG files into the in-memory drawing database.

DWG parsing is provided through a dedicated Web Worker bundle (`libredwg-parser-worker.js`). **This converter is intended for Web Worker use only.** That restriction is not because parsing cannot run on the main thread in principle; it is a deliberate licensing choice. LibreDWG and its WebAssembly wrapper are copyleft (GPL), and loading them in a separate worker bundle helps keep that parser code apart from the main MIT-licensed application so license obligations are easier to manage.

## Key Features

- **DWG File Support**: Read and convert DWG files to the drawing database
- **Integration**: Designed to work with the RealDWG-Web data model and converter manager
- **WebAssembly Powered**: Uses LibreDWG compiled to WASM, loaded in a Web Worker for license isolation

## Installation

```bash
npm install @mlightcad/libredwg-converter
```

> **Peer dependencies:**
> - `@mlightcad/data-model`

## Usage Example

```typescript
import { AcDbDatabaseConverterManager, AcDbFileType } from '@mlightcad/data-model';
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter';

const dwgConverter = new AcDbLibreDwgConverter({
  useWorker: true,
  parserWorkerUrl: './assets/libredwg-parser-worker.js'
});
AcDbDatabaseConverterManager.instance.register(AcDbFileType.DWG, dwgConverter);
```

Deploy `libredwg-parser-worker.js` from this package's `dist/` folder to a public URL accessible by your application.

## API

- **AcDbLibreDwgConverter**: Main converter class for DWG files (extends `AcDbDatabaseConverter`)

## Dependencies

- **@mlightcad/data-model**: Drawing database and entity definitions
- **@mlightcad/libredwg-web**: WASM wrapper for LibreDWG, loaded in the worker bundle by design for license isolation

## API Documentation

For detailed API documentation, visit the [RealDWG-Web documentation](https://mlight-lee.github.io/realdwg-web/).

## Contributing

This package is part of the RealDWG-Web monorepo. Please refer to the main project README for contribution guidelines.
