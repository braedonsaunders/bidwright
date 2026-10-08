import { acdbCreateDxfPairReader, acdbHostApplicationServices } from '../src/base'
import {
  AcDbCodePage,
  acdbDwgCodePageToEncoding,
  acdbNormalizeTextEncoding
} from '../src/misc'
import { AcDbDatabase } from '../src/database'
import { AcDbNativeDxfConverter } from '../src/dxf'

/** '한글' encoded in CP949 / EUC-KR (KS X 1001): 0xC7 0xD1 0xB1 0xDB. */
const HANGUL_CP949 = Uint8Array.from([0xc7, 0xd1, 0xb1, 0xdb])

/**
 * Builds DXF bytes whose lines are ASCII except the entries listed in
 * `rawLines`, which are spliced in as raw byte sequences. This lets tests
 * embed non-UTF-8 (e.g. CP949) string values that `TextEncoder` cannot
 * produce.
 */
function buildDxfBytes(lines: (string | Uint8Array)[]): ArrayBuffer {
  const chunks: Uint8Array[] = []
  for (const line of lines) {
    if (typeof line === 'string') {
      const bytes = new Uint8Array(line.length)
      for (let i = 0; i < line.length; i++) {
        const c = line.charCodeAt(i)
        if (c > 0x7f) throw new Error('non-ASCII line must be Uint8Array')
        bytes[i] = c
      }
      chunks.push(bytes)
    } else {
      chunks.push(line)
    }
    chunks.push(Uint8Array.from([10]))
  }
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out.buffer
}

/**
 * Minimal pre-R2007 DXF with a Korean layer name and Korean TEXT string,
 * both encoded in CP949.
 */
function buildKoreanDxf(codePageValue: string | null): ArrayBuffer {
  const lines: (string | Uint8Array)[] = [
    '0', 'SECTION',
    '2', 'HEADER',
    '9', '$ACADVER',
    '1', 'AC1015',
    ...(codePageValue
      ? (['9', '$DWGCODEPAGE', '3', codePageValue] as string[])
      : []),
    '0', 'ENDSEC',
    '0', 'SECTION',
    '2', 'TABLES',
    '0', 'TABLE',
    '2', 'LAYER',
    '0', 'LAYER',
    '5', '10',
    '100', 'AcDbSymbolTableRecord',
    '100', 'AcDbLayerTableRecord',
    '2'
  ]
  lines.push(HANGUL_CP949) // layer name (group 2)
  lines.push('70', '0', '62', '7', '6', 'Continuous', '0', 'ENDTAB', '0', 'ENDSEC')
  lines.push(
    '0', 'SECTION',
    '2', 'ENTITIES',
    '0', 'TEXT',
    '5', '1A',
    '100', 'AcDbEntity',
    '8'
  )
  lines.push(HANGUL_CP949) // layer name (group 8)
  lines.push('100', 'AcDbText', '10', '0', '20', '0', '30', '0', '40', '2.5', '1')
  lines.push(HANGUL_CP949) // text string (group 1)
  lines.push('0', 'ENDSEC', '0', 'EOF')
  return buildDxfBytes(lines)
}

function readStringPairs(
  reader: ReturnType<typeof acdbCreateDxfPairReader>
): Record<number, string> {
  const values: Record<number, string> = {}
  for (let pair = reader.next(); pair; pair = reader.next()) {
    if (pair.type === 'string' && (pair.code === 1 || pair.code === 8)) {
      values[pair.code] = pair.value as string
    }
  }
  return values
}

describe('AcDbCodePage', () => {
  it('maps Korean code pages onto the WHATWG euc-kr label', () => {
    expect(acdbDwgCodePageToEncoding(AcDbCodePage.CP949)).toBe('euc-kr')
    expect(acdbDwgCodePageToEncoding(AcDbCodePage.ANSI_949)).toBe('euc-kr')
  })

  it('normalizes common Korean/Chinese code page aliases for TextDecoder', () => {
    expect(acdbNormalizeTextEncoding('cp949')).toBe('euc-kr')
    expect(acdbNormalizeTextEncoding('CP949')).toBe('euc-kr')
    expect(acdbNormalizeTextEncoding('uhc')).toBe('euc-kr')
    expect(acdbNormalizeTextEncoding('cp936')).toBe('gbk')
    // Underscore / mixed-case forms of known labels normalize too.
    expect(acdbNormalizeTextEncoding('euc-kr')).toBe('euc-kr')
    expect(acdbNormalizeTextEncoding('EUC_KR')).toBe('euc-kr')
    expect(acdbNormalizeTextEncoding('windows-949')).toBe('euc-kr')
    // Unrelated supported labels pass through unchanged.
    expect(acdbNormalizeTextEncoding('windows-1252')).toBe('windows-1252')
    expect(acdbNormalizeTextEncoding('utf-8')).toBe('utf-8')
  })
})

describe('DXF Korean (CP949) text decoding', () => {
  it('auto-detects ANSI_949 from $DWGCODEPAGE and decodes Korean strings', () => {
    const values = readStringPairs(
      acdbCreateDxfPairReader(buildKoreanDxf('ANSI_949'))
    )
    expect(values[1]).toBe('한글')
    expect(values[8]).toBe('한글')
  })

  it('honors an explicit cp949 encoding override (normalized to euc-kr)', () => {
    // Header lies: declares ANSI_1252 but the bytes are CP949.
    const values = readStringPairs(
      acdbCreateDxfPairReader(buildKoreanDxf('ANSI_1252'), {
        encoding: 'cp949'
      })
    )
    expect(values[1]).toBe('한글')
    expect(values[8]).toBe('한글')
  })

  it('decodes Korean layer names and text via the native DXF converter', async () => {
    const db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db
    const converter = new AcDbNativeDxfConverter()
    await converter.read(buildKoreanDxf('ANSI_949'), db, {})

    // Layer name decoded from CP949 bytes.
    const layerNames = [...db.tables.layerTable.newIterator()].map(l => l.name)
    expect(layerNames).toContain('한글')

    // TEXT entity string decoded from CP949 bytes.
    const texts = [
      ...db.tables.blockTable.modelSpace.newIterator()
    ]
      .filter(entity => 'textString' in entity)
      .map(entity => (entity as { textString: string }).textString)
    expect(texts).toContain('한글')
  })

  it('decodes a stale pre-2007 ANSI_936 header as UTF-8 when the bytes are UTF-8', () => {
    // Some tools rewrite a legacy header onto UTF-8 content: the declared
    // version and code page are both stale. Byte validation must win over
    // the header, or every string in such files turns into mojibake.
    const lines = [
      '0', 'SECTION', '2', 'HEADER',
      '9', '$ACADVER', '1', 'AC1015',
      '9', '$DWGCODEPAGE', '3', 'ANSI_936',
      '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'TEXT', '5', '1A', '100', 'AcDbEntity',
      '8', '图层',
      '100', 'AcDbText', '10', '0', '20', '0', '30', '0', '40', '2.5', '1', '中文文本',
      '0', 'ENDSEC', '0', 'EOF'
    ]
    const bytes = new TextEncoder().encode(lines.join('\r\n') + '\r\n')
    const values = readStringPairs(acdbCreateDxfPairReader(bytes))
    expect(values[1]).toBe('中文文本')
    expect(values[8]).toBe('图层')
  })
})
