// BUILD-33: every upstream Beautiful Mermaid export is either still exported
// here, or has a migration line in docs/fork-differences.md.
//
// The gap this closes: `THEMES` was dropped in favour of the Style/Palette
// system and recorded only in CHANGELOG.md. A consumer porting upstream code
// hit it as `TypeError: Cannot read properties of undefined` with nothing
// searchable to explain it, because destructuring a missing export yields
// `undefined` rather than failing at import.
//
// Upstream's own type declarations are the input, so this tracks the real
// surface rather than a list someone remembered to update. `beautiful-mermaid`
// is a devDependency; the test skips rather than fails if it is absent, since a
// missing dev tree is an environment problem, not a documentation defect.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const UPSTREAM_DTS = join(ROOT, 'node_modules', 'beautiful-mermaid', 'dist', 'index.d.ts')
const FORK_DTS = join(ROOT, 'dist', 'index.d.ts')
const FORK_DIFFERENCES = join(ROOT, 'docs', 'fork-differences.md')

/** Names from upstream's terminal `export { ... }` clause, minus `type` markers and aliases. */
function upstreamExports(): string[] {
  const source = readFileSync(UPSTREAM_DTS, 'utf8')
  const clause = source.match(/export \{([^}]*)\};?\s*$/m)?.[1]
  if (!clause) throw new Error(`could not read upstream export clause from ${UPSTREAM_DTS}`)
  return [...new Set(
    clause
      .split(',')
      .map(entry => entry.trim().replace(/^type\s+/, ''))
      .map(entry => entry.split(/\s+as\s+/).pop()!.trim())
      .filter(entry => /^[A-Za-z_$][\w$]*$/.test(entry)),
  )].sort()
}

describe('upstream export migration', () => {
  test('every upstream export is re-exported here or documented as removed', () => {
    if (!existsSync(UPSTREAM_DTS)) return // devDependency absent; nothing to compare against
    if (!existsSync(FORK_DTS)) throw new Error('dist/index.d.ts missing — run `bun run build` first')

    const forkSurface = readFileSync(FORK_DTS, 'utf8')
    const migrationDoc = readFileSync(FORK_DIFFERENCES, 'utf8')
    const names = upstreamExports()
    expect(names.length, 'upstream export clause parsed').toBeGreaterThan(5)

    const undocumented: string[] = []
    for (const name of names) {
      // The fork entry re-exports through minified aliases, so match the public
      // name as a word rather than parsing the whole rename table.
      const exportedHere = new RegExp(`\\b(?:as )?${name}\\b`).test(forkSurface)
      const documented = new RegExp(`\`${name}\``).test(migrationDoc)
      if (!exportedHere && !documented) undocumented.push(name)
    }

    expect(
      undocumented,
      'upstream exports dropped without a migration line in docs/fork-differences.md',
    ).toEqual([])
  })

  test('the documented removals are genuinely absent from the fork entry', () => {
    if (!existsSync(UPSTREAM_DTS) || !existsSync(FORK_DTS)) return
    const forkSurface = readFileSync(FORK_DTS, 'utf8')
    // Guards the other direction: if one of these is ever re-added, the doc row
    // telling people to migrate away from it becomes a lie.
    for (const removed of ['THEMES', 'ThemeName', 'renderMermaidSync', 'renderMermaidAscii']) {
      expect(new RegExp(`\\bas ${removed}\\b`).test(forkSurface), `${removed} is still absent`).toBe(false)
    }
  })
})
