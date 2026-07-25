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

/** Public names from every `export { ... }` clause, resolving minified aliases. */
function exportedNames(source: string): string[] {
  const names = new Set<string>()
  for (const clause of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of clause[1]!.split(',')) {
      const name = raw
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop()!
        .trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }
  return [...names].sort()
}

/** First-column export names from the dedicated upstream migration table only. */
function documentedRemovals(markdown: string): string[] {
  const section = markdown.match(/## Migrating from upstream: every export this fork does not have([\s\S]*?)(?=\n## |\s*$)/)?.[1]
  if (!section) throw new Error(`could not read upstream migration section from ${FORK_DIFFERENCES}`)
  return [...section.matchAll(/^\|\s*`([A-Za-z_$][\w$]*)`\s*\|/gm)].map(match => match[1]!).sort()
}

describe('upstream export migration', () => {
  test('every upstream export is re-exported here or documented as removed', () => {
    if (!existsSync(UPSTREAM_DTS)) return // devDependency absent; nothing to compare against
    if (!existsSync(FORK_DTS)) throw new Error('dist/index.d.ts missing — run `bun run build` first')

    const names = exportedNames(readFileSync(UPSTREAM_DTS, 'utf8'))
    const forkExports = new Set(exportedNames(readFileSync(FORK_DTS, 'utf8')))
    const documented = new Set(documentedRemovals(readFileSync(FORK_DIFFERENCES, 'utf8')))
    expect(names.length, 'upstream export clause parsed').toBeGreaterThan(5)
    expect(documented.size, 'migration table parsed').toBeGreaterThan(0)

    const undocumented = names.filter(name => !forkExports.has(name) && !documented.has(name))

    expect(undocumented, 'upstream exports dropped without a migration line in docs/fork-differences.md').toEqual([])
  })

  test('the documented removals are genuinely absent from the fork entry', () => {
    if (!existsSync(UPSTREAM_DTS) || !existsSync(FORK_DTS)) return
    const upstream = new Set(exportedNames(readFileSync(UPSTREAM_DTS, 'utf8')))
    const fork = new Set(exportedNames(readFileSync(FORK_DTS, 'utf8')))
    const documented = documentedRemovals(readFileSync(FORK_DIFFERENCES, 'utf8'))

    // Guards the other direction without a second hard-coded authority: every
    // migration row must still name a real upstream export that is absent here.
    for (const removed of documented) {
      expect(upstream.has(removed), `${removed} is an upstream export`).toBe(true)
      expect(fork.has(removed), `${removed} is still absent`).toBe(false)
    }
  })
})
