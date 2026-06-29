// Doc-sync: route-contracts.md §8 must list the real post-ELK pass order, generated
// from the LAYOUT_PIPELINE manifest (closes the 16-vs-5 drift the spec diagnosed).
// Regenerate with: UPDATE_DOCS=1 bun test src/__tests__/layout-pass-docsync.test.ts
import { describe, test, expect } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { LAYOUT_PIPELINE } from '../layout-engine.ts'

const DOC = new URL('../../docs/design/system/route-contracts.md', import.meta.url)
const START = '<!-- LAYOUT-PIPELINE:start -->'
const END = '<!-- LAYOUT-PIPELINE:end -->'

const generated = (): string =>
  `${START}\n\n` + LAYOUT_PIPELINE.map((p, i) => `${i + 1}. \`${p.id}\` - ${p.doc}`).join('\n') + `\n\n${END}`

describe('route-contracts.md §8 pass manifest', () => {
  test('is in sync with LAYOUT_PIPELINE (regenerate with UPDATE_DOCS=1)', () => {
    const text = readFileSync(DOC, 'utf8')
    const start = text.indexOf(START)
    const end = text.indexOf(END)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const want = generated()
    const have = text.slice(start, end + END.length)
    if (process.env.UPDATE_DOCS) {
      if (have !== want) writeFileSync(DOC, text.slice(0, start) + want + text.slice(end + END.length))
      return
    }
    expect(have).toBe(want)
  })
})
