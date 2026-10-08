const SIGNATURES = ['ACIS BinaryFile', 'ASM BinaryFile4'] as const;
const DATA_END_MARKERS = new Set([
  'End-of-ACIS-data',
  'End-of-ASM-data',
  'End-of-ACIS-History-data',
]);

/**
 * SAB tag bytes (ezdxf `Tags`).
 * Each tag identifies the type of the next value in a SAB record stream.
 */
export const AcDbAcisSabTag = {
  NoType: 0x00, Byte: 0x01, Char: 0x02, Short: 0x03, Int: 0x04, Float: 0x05,
  Double: 0x06, Str: 0x07, Str2: 0x08, Str3: 0x09, BoolTrue: 0x0a,
  BoolFalse: 0x0b, Pointer: 0x0c, EntityType: 0x0d, EntityTypeEx: 0x0e,
  SubtypeStart: 0x0f, SubtypeEnd: 0x10, RecordEnd: 0x11, LiteralStr: 0x12,
  LocationVec: 0x13, DirectionVec: 0x14, Enum: 0x15, Unknown0x17: 0x17,
} as const;

/** A 3D vector tuple `[x, y, z]` as stored in SAB location/direction tags. */
export type AcDbAcisSabVector = readonly [number, number, number];

/** Possible decoded values for a single SAB field token. */
export type AcDbAcisSabTokenValue = number | boolean | string | AcDbAcisSabVector;

/**
 * One decoded field token from a SAB record stream.
 */
export interface AcDbAcisSabToken {
  /** SAB tag byte identifying the value type. */
  readonly tag: number;
  /** Decoded field value. */
  readonly value: AcDbAcisSabTokenValue;
}

/**
 * One ACIS entity record from a SAB stream.
 */
export interface AcDbAcisSabRecord {
  /** Record identity = the first entity-type, e.g. `"body"`, `"plane-surface"`. */
  readonly type: string;
  /**
   * All field tokens in wire order, including entity-type tokens (the first is
   * the record identity; later ones name nested subtypes, e.g. an
   * `intcurve-curve`'s `nullbs` geometry).
   */
  readonly tokens: readonly AcDbAcisSabToken[];
}

/**
 * Header metadata parsed from the start of a SAB stream.
 */
export interface AcDbAcisSabHeader {
  /** File signature, e.g. `"ACIS BinaryFile"` or `"ASM BinaryFile4"`. */
  readonly signature: string;
  /** SAB format version number. */
  readonly version: number;
  /** Total record count declared in the header. */
  readonly numRecords: number;
  /** Entity count declared in the header. */
  readonly numEntities: number;
  /** Header flags bitmask. */
  readonly flags: number;
  /** Product identifier string. */
  readonly productId: string;
  /** ACIS kernel version string. */
  readonly acisVersion: string;
  /** Creation timestamp string from the SAB header. */
  readonly creationDate: string;
  /** Model units expressed in millimeters. */
  readonly unitsInMm: number;
  /** Resolution tolerance from the SAB header. */
  readonly resTol: number;
  /** Normal tolerance from the SAB header. */
  readonly norTol: number;
}

/**
 * Fully parsed SAB payload: file header plus the ordered record list.
 */
export interface AcDbAcisSabData {
  /** Parsed SAB file header. */
  readonly header: AcDbAcisSabHeader;
  /** Ordered list of decoded entity records. */
  readonly records: readonly AcDbAcisSabRecord[];
}

/** Sequential byte reader for low-level SAB decoding. */
class AcDbAcisSabByteReader {
  index = 0;
  private readonly view: DataView;
  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  get hasData(): boolean { return this.index < this.data.length; }
  private require(n: number): void {
    if (this.index + n > this.data.length) {
      throw new RangeError(`SAB: read past end of data (need ${String(n)} at ${String(this.index)})`);
    }
  }
  readByte(): number {
    this.require(1);
    return this.data[this.index++] ?? 0;
  }
  readInt(): number {
    this.require(4);
    const v = this.view.getInt32(this.index, true);
    this.index += 4;
    return v;
  }
  readFloat(): number {
    this.require(8);
    const v = this.view.getFloat64(this.index, true);
    this.index += 8;
    return v;
  }
  readStr(length: number): string {
    this.require(length);
    const text = LATIN1.decode(this.data.subarray(this.index, this.index + length));
    this.index += length;
    return text;
  }
}

const LATIN1 = new TextDecoder('latin1');

function readHeader(r: AcDbAcisSabByteReader, data: Uint8Array): AcDbAcisSabHeader {
  let signature = '';
  for (const sig of SIGNATURES) {
    if (startsWithAscii(data, sig)) { signature = sig; r.index = sig.length; break; }
  }
  if (signature === '') throw new RangeError('SAB: not a SAB stream (missing signature)');

  const version = r.readInt();
  const numRecords = r.readInt();
  const numEntities = r.readInt();
  const flags = r.readInt();
  const productId = readStrTag(r);
  const acisVersion = readStrTag(r);
  const creationDate = readStrTag(r);
  const unitsInMm = readDoubleTag(r);
  const resTol = readDoubleTag(r);
  const norTol = readDoubleTag(r);
  return {
    signature, version, numRecords, numEntities, flags,
    productId, acisVersion, creationDate, unitsInMm, resTol, norTol,
  };
}

function readStrTag(r: AcDbAcisSabByteReader): string {
  if (r.readByte() !== AcDbAcisSabTag.Str) throw new RangeError('SAB: expected string tag (0x07)');
  return r.readStr(r.readByte());
}

function readDoubleTag(r: AcDbAcisSabByteReader): number {
  if (r.readByte() !== AcDbAcisSabTag.Double) throw new RangeError('SAB: expected double tag (0x06)');
  return r.readFloat();
}

/**
 * Read one record (tokens up to RECORD_END, or the data-end marker at stream
 * end). Mirrors ezdxf `Decoder.read_record`: the entity-type name is assembled
 * from one or more ENTITY_TYPE_EX parts plus a final ENTITY_TYPE, joined by `-`.
 */
function readRecord(r: AcDbAcisSabByteReader): AcDbAcisSabRecord {
  const tokens: AcDbAcisSabToken[] = [];
  const typeParts: string[] = [];
  let type = '';
  let subtypeLevel = 0;

  for (;;) {
    if (!r.hasData) {
      if (DATA_END_MARKERS.has(type)) return { type, tokens };
      throw new RangeError('SAB: premature end of data');
    }
    const tag = r.readByte();
    switch (tag) {
      case AcDbAcisSabTag.Int: tokens.push({ tag, value: r.readInt() }); break;
      case AcDbAcisSabTag.Double: tokens.push({ tag, value: r.readFloat() }); break;
      case AcDbAcisSabTag.Str: tokens.push({ tag, value: r.readStr(r.readByte()) }); break;
      case AcDbAcisSabTag.Pointer: tokens.push({ tag, value: r.readInt() }); break;
      case AcDbAcisSabTag.BoolTrue: tokens.push({ tag, value: true }); break;
      case AcDbAcisSabTag.BoolFalse: tokens.push({ tag, value: false }); break;
      case AcDbAcisSabTag.LiteralStr: tokens.push({ tag, value: r.readStr(r.readInt()) }); break;
      case AcDbAcisSabTag.EntityTypeEx: typeParts.push(r.readStr(r.readByte())); break;
      case AcDbAcisSabTag.EntityType: {
        typeParts.push(r.readStr(r.readByte()));
        const name = typeParts.join('-');
        typeParts.length = 0;
        // The record's identity is the FIRST entity-type. Later ENTITY_TYPE
        // tokens belong to nested subtypes (e.g. an intcurve-curve's `nullbs`
        // geometry) — keep them as tokens, don't overwrite the record type.
        if (type === '') type = name;
        tokens.push({ tag, value: name });
        break;
      }
      case AcDbAcisSabTag.LocationVec: tokens.push({ tag, value: readVec(r) }); break;
      case AcDbAcisSabTag.DirectionVec: tokens.push({ tag, value: readVec(r) }); break;
      case AcDbAcisSabTag.Enum: tokens.push({ tag, value: r.readInt() }); break;
      case AcDbAcisSabTag.Unknown0x17: tokens.push({ tag, value: r.readFloat() }); break;
      case AcDbAcisSabTag.SubtypeStart: subtypeLevel++; tokens.push({ tag, value: subtypeLevel }); break;
      case AcDbAcisSabTag.SubtypeEnd: tokens.push({ tag, value: subtypeLevel }); subtypeLevel--; break;
      case AcDbAcisSabTag.RecordEnd: return { type, tokens };
      default:
        throw new RangeError(`SAB: unknown tag 0x${tag.toString(16)} (${String(tag)}) in record '${type}'`);
    }
  }
}

function readVec(r: AcDbAcisSabByteReader): AcDbAcisSabVector {
  return [r.readFloat(), r.readFloat(), r.readFloat()];
}

/**
 * Decode a byte-true SAB stream into a header + record list. Reading stops at
 * the `End-of-(ACIS|ASM)-data` record (inclusive) or when the data is exhausted.
 *
 * @param data - Raw SAB byte stream starting at (or containing) a known signature.
 * @returns Parsed header and records.
 * @throws `RangeError` on a malformed or truncated stream.
 */
export function acdbParseAcisSab(data: Uint8Array): AcDbAcisSabData {
  const r = new AcDbAcisSabByteReader(data);
  const header = readHeader(r, data);
  const records: AcDbAcisSabRecord[] = [];
  while (r.hasData) {
    const record = readRecord(r);
    records.push(record);
    if (DATA_END_MARKERS.has(record.type)) break;
  }
  return { header, records };
}

function startsWithAscii(data: Uint8Array, prefix: string): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}
