/**
 * Doc-sync: the built-in family roster table in docs/design/abstraction-audit.md is generated
 * from BUILTIN_FAMILY_METADATA. This test rebuilds the table from the registry and asserts the
 * doc's <!-- FAMILY-TABLE --> region matches, so adding or renaming a built-in family forces the
 * audit to be regenerated in the same change (the prose inventory cannot drift from the code).
 *
 * Regenerate the table after an intentional registry change:
 *   UPDATE_GOLDEN=1 bun test src/__tests__/audit-family-table.test.ts
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'

const auditPath = join(import.meta.dir, '..', '..', 'docs', 'design', 'abstraction-audit.md')
const START = '<!-- FAMILY-TABLE:start -->'
const END = '<!-- FAMILY-TABLE:end -->'

function buildFamilyTable(): string {
  const head = '| Family | `kind` | Mermaid header(s) | SDK narrower |\n|---|---|---|---|'
  const rows = BUILTIN_FAMILY_METADATA.map(
    f => `| ${f.label} | \`${f.id}\` | ${f.headers.map(h => `\`${h}\``).join(', ')} | \`${f.narrower}\` |`,
  )
  return [head, ...rows].join('\n')
}

function extractRegion(doc: string): string {
  const s = doc.indexOf(START)
  const e = doc.indexOf(END)
  if (s < 0 || e < 0) throw new Error('FAMILY-TABLE markers not found in abstraction-audit.md')
  return doc.slice(s + START.length, e).trim()
}

describe('abstraction-audit family table — synced with BUILTIN_FAMILY_METADATA', () => {
  it('matches the table generated from the registry (regenerate with UPDATE_GOLDEN=1)', () => {
    const table = buildFamilyTable()
    if (process.env.UPDATE_GOLDEN) {
      const doc = readFileSync(auditPath, 'utf-8')
      const updated = doc.replace(new RegExp(`${START}[\\s\\S]*?${END}`), `${START}\n${table}\n${END}`)
      writeFileSync(auditPath, updated)
    }
    expect(extractRegion(readFileSync(auditPath, 'utf-8'))).toBe(table)
  })

  it('lists exactly one data row per registered family', () => {
    const region = extractRegion(readFileSync(auditPath, 'utf-8'))
    const dataRows = region.split('\n').filter(l => l.startsWith('| ')).length - 1 // minus header row
    expect(dataRows).toBe(BUILTIN_FAMILY_METADATA.length)
  })
})
