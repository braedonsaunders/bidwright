/**
 * Decrypts obfuscated ACIS SAT text stored in DXF group codes 1 and 3.
 *
 * AutoCAD applies `chr(159 - ord(c))` to every character above ASCII space.
 * See LibreDWG `dec_sat.pl` and the DXF reference for 3DSOLID/REGION/BODY.
 */

/**
 * Decrypts an obfuscated SAT fragment from a DXF group 1 or 3 value.
 *
 * @param encrypted - Obfuscated SAT fragment.
 */
export function acdbDecryptAcisData(encrypted: string): string {
  let decrypted = ''
  for (let i = 0; i < encrypted.length; i++) {
    const code = encrypted.charCodeAt(i)
    decrypted += code <= 32 ? encrypted[i]! : String.fromCharCode(159 - code)
  }
  return decrypted
}

/**
 * Returns true when `data` looks like encrypted ACIS rather than plain SAT/ASM
 * text (which typically starts with a version number or "ACIS"/"ASM").
 *
 * @param data - Raw group 1/3 value before decryption.
 */
export function acdbIsEncryptedAcisData(data: string): boolean {
  const trimmed = data.trimStart()
  if (!trimmed) {
    return false
  }
  if (/^\d/.test(trimmed) || /^ACIS/i.test(trimmed) || /^ASM/i.test(trimmed)) {
    return false
  }
  if (
    /^(body|point|plane|cone|cylinder|sphere|torus|lump|shell|face|edge|wire|transform)\b/i.test(
      trimmed
    )
  ) {
    return false
  }
  if (/\b(body|point|straight-curve|ellipse-curve)\s+\$/.test(trimmed)) {
    return false
  }
  return true
}

/**
 * Decrypts ACIS data when it is still in the DXF obfuscated form; otherwise
 * returns the input unchanged.
 *
 * @param data - Raw or already-decrypted SAT fragment.
 */
export function acdbNormalizeAcisData(data: string): string {
  if (!data || !acdbIsEncryptedAcisData(data)) {
    return data
  }
  return acdbDecryptAcisData(data)
}

/**
 * Decrypts each SAT line and joins them with `\n`.
 *
 * @param lines - One logical SAT line per group-code 1 (group 3 fragments are
 *   already stitched onto the preceding line).
 */
export function acdbJoinAcisPayloadLines(lines: readonly string[]): string {
  if (lines.length === 0) {
    return ''
  }
  return lines.map(line => acdbNormalizeAcisData(line)).join('\n')
}

/**
 * Stitches group-code 1/3 SAT fragments: group 1 starts a new SAT line and
 * group 3 continues the previous line (255-character splits).
 *
 * @param lines - Mutable accumulator for logical SAT lines.
 * @param code - DXF group code (1 or 3).
 * @param value - Raw group value to append.
 */
export function acdbAppendAcisPayloadFragment(
  lines: string[],
  code: 1 | 3,
  value: string
): void {
  if (code === 1) {
    lines.push(value)
    return
  }
  if (lines.length === 0) {
    lines.push(value)
    return
  }
  lines[lines.length - 1] += value
}

/**
 * Joins encrypted ACSH OBJECT group-1 chunks (no newlines between chunks).
 *
 * @param chunks - Ordered group 1/3 fragments from an ACSH OBJECT entry.
 */
export function acdbJoinAcisObjectChunks(chunks: readonly string[]): string {
  if (chunks.length === 0) {
    return ''
  }
  return acdbNormalizeAcisData(chunks.join(''))
}
