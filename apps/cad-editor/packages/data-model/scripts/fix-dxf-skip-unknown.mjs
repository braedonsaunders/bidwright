/**
 * Convert dxfInFields unknown-code early exits:
 *   default:
 *     filer.pushBackItem(item)
 *     ...optional commit...
 *     return this|false
 * into:
 *   default:
 *     break
 *
 * Official DXF guidance: ignore undefined group codes; do not assume order.
 */
import fs from 'node:fs'
import path from 'node:path'

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

const root = path.resolve('src')
const files = walk(root)
let changedFiles = 0
let replacements = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  if (!src.includes('filer.pushBackItem(item)')) continue
  if (!src.includes('dxfInFields') && !src.includes('readItem(')) continue

  const lines = src.split(/\r?\n/)
  const out = []
  let i = 0
  let fileChanges = 0

  while (i < lines.length) {
    const line = lines[i]
    const defMatch = /^(?<indent>[ \t]*)default:\s*$/.exec(line)
    if (!defMatch) {
      out.push(line)
      i += 1
      continue
    }

    let j = i + 1
    let sawPush = false
    let sawReturn = false

    while (j < lines.length) {
      const l = lines[j]
      if (/filer\.pushBackItem\(item\)/.test(l)) {
        sawPush = true
        j += 1
        continue
      }
      if (/^[ \t]*return (this|false)\s*;?\s*$/.test(l)) {
        if (sawPush) {
          sawReturn = true
          j += 1
        }
        break
      }
      // Allow commit / flush statements between pushBack and return.
      if (sawPush && (/^[ \t]+/.test(l) || l.trim() === '')) {
        j += 1
        continue
      }
      break
    }

    if (sawPush && sawReturn) {
      const indent = defMatch.groups.indent
      out.push(`${indent}default:`)
      out.push(`${indent}  break`)
      fileChanges += 1
      i = j
      continue
    }

    out.push(line)
    i += 1
  }

  if (fileChanges > 0) {
    const text = out.join('\n')
    // Preserve trailing newline if original had one.
    fs.writeFileSync(file, src.endsWith('\n') ? text + '\n' : text)
    changedFiles += 1
    replacements += fileChanges
    console.log(`${path.relative(root, file)}: ${fileChanges}`)
  }
}

console.log(`TOTAL ${changedFiles} files, ${replacements} replacements`)
