/// <reference lib="webworker" />
import { AcDbBaseWorker } from '@mlightcad/data-model'
import { ParsedDxf } from '@mlightcad/dxf-json'

import { AcDbDxfParser } from './AcDbDxfParser'

/**
 * DXF parsing worker
 */
class AcDbDxfParserWorker extends AcDbBaseWorker<ArrayBuffer, ParsedDxf> {
  protected async executeTask(data: ArrayBuffer): Promise<ParsedDxf> {
    const parser = new AcDbDxfParser()
    return parser.parse(data)
  }
}

// Initialize the worker
new AcDbDxfParserWorker()
