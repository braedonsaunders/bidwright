export enum AcDbCodePage {
  UTF8 = 0,
  US_ASCII = 1,
  ISO_8859_1,
  ISO_8859_2,
  ISO_8859_3,
  ISO_8859_4,
  ISO_8859_5,
  ISO_8859_6,
  ISO_8859_7,
  ISO_8859_8,
  ISO_8859_9,
  CP437, // DOS English
  CP850, // 12 DOS Latin-1
  CP852, // DOS Central European
  CP855, // DOS Cyrillic
  CP857, // DOS Turkish
  CP860, // DOS Portoguese
  CP861, // DOS Icelandic
  CP863, // DOS Hebrew
  CP864, // DOS Arabic (IBM)
  CP865, // DOS Nordic
  CP869, // DOS Greek
  CP932, // DOS Japanese (shiftjis)
  MACINTOSH, // 23
  BIG5,
  CP949 = 25, // Korean (Wansung + Johab)
  JOHAB = 26, // Johab?
  CP866 = 27, // Russian
  ANSI_1250 = 28, // Central + Eastern European
  ANSI_1251 = 29, // Cyrillic
  ANSI_1252 = 30, // Western European
  GB2312 = 31, // EUC-CN Chinese
  ANSI_1253, // Greek
  ANSI_1254, // Turkish
  ANSI_1255, // Hebrew
  ANSI_1256, // Arabic
  ANSI_1257, // Baltic
  ANSI_874, // Thai
  ANSI_932, // 38 Japanese (extended shiftjis, windows-31j)
  ANSI_936, // 39 Simplified Chinese
  ANSI_949, // 40 Korean Wansung
  ANSI_950, // 41 Trad Chinese
  ANSI_1361, // 42 Korean Wansung
  UTF16 = 43,
  ANSI_1258 = 44, // Vietnamese
  UNDEFINED = 0xff // mostly R11
}

const encodings = [
  'utf-8', // 0
  'utf-8', // US ASCII
  'iso-8859-1',
  'iso-8859-2',
  'iso-8859-3',
  'iso-8859-4',
  'iso-8859-5',
  'iso-8859-6',
  'iso-8859-7',
  'iso-8859-8',
  'iso-8859-9', // 10
  'utf-8', // DOS English
  'utf-8', // 12 DOS Latin-1
  'utf-8', // DOS Central European
  'utf-8', // DOS Cyrillic
  'utf-8', // DOS Turkish
  'utf-8', // DOS Portoguese
  'utf-8', // DOS Icelandic
  'utf-8', // DOS Hebrew
  'utf-8', // DOS Arabic (IBM)
  'utf-8', // DOS Nordic
  'utf-8', // DOS Greek
  'shift-jis', // DOS Japanese (shiftjis)
  'macintosh', // 23
  'big5',
  'euc-kr', // Korean (CP949/Wansung + UHC extensions; WHATWG 'euc-kr' decodes windows-949)
  'utf-8', // Johab?
  'ibm866', // Russian
  'windows-1250', // Central + Eastern European
  'windows-1251', // Cyrillic
  'windows-1252', // Western European
  'gbk', // EUC-CN Chinese
  'windows-1253', // Greek
  'windows-1254', // Turkish
  'windows-1255', // Hebrew
  'windows-1256', // Arabic
  'windows-1257', // Baltic
  'windows-874', // Thai
  'shift-jis', // 38 Japanese (extended shiftjis, windows-31j)
  'gbk', // 39 Simplified Chinese
  'euc-kr', // 40 Korean Wansung
  'big5', // 41 Trad Chinese
  'utf-8', // 42 Korean Wansung
  'utf-16le',
  'windows-1258' // Vietnamese
]

export const acdbDwgCodePageToEncoding = (codepage: AcDbCodePage) => {
  return encodings[codepage]
}

/**
 * Common Korean/Chinese code page names that `TextDecoder` rejects but map
 * onto supported WHATWG encodings.
 *
 * `TextDecoder` has no `'cp949'` label even though the encoding itself is
 * supported: the WHATWG `'euc-kr'` label decodes windows-949, which covers
 * CP949 (Wansung + the UHC extension). The same applies to `'cp936'` →
 * `'gbk'`. Keys are lower-cased.
 */
const textEncodingAliases: Record<string, string> = {
  cp949: 'euc-kr',
  uhc: 'euc-kr',
  // Canonicalize after stripping `_`/`-` so `euc_kr` / `EUC_KR` work too.
  euckr: 'euc-kr',
  windows949: 'euc-kr',
  ksc56011987: 'euc-kr',
  cp936: 'gbk'
}

/**
 * Normalizes a user-supplied encoding label to one `TextDecoder` accepts.
 *
 * Unknown labels pass through unchanged so `TextDecoder` reports the error
 * itself. Labels are matched case-insensitively with `'_'` and `'-'` ignored,
 * mirroring how DXF code page names arrive in mixed forms.
 *
 * @param encoding - Encoding label such as `'cp949'` or `'EUC-KR'`.
 * @returns A label `new TextDecoder(...)` accepts in every runtime.
 */
export const acdbNormalizeTextEncoding = (encoding: string): string => {
  const key = encoding.toLowerCase().replace(/[_-]/g, '')
  return textEncodingAliases[key] ?? encoding
}
