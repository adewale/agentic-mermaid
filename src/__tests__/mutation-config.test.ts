import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markedMutationScopes } from '../../scripts/quality/marked-mutation-scopes.mjs'
import { MUTATION_PROFILES } from '../../stryker.config.mjs'

const ROOT = join(import.meta.dir, '..', '..')

describe('mutation profile policy', () => {
  test('marked scopes resolve to exactly the lines between one ordered marker pair', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-mutation-scope-'))
    try {
      const write = (name: string, lines: string[]) => writeFileSync(join(dir, name), lines.join('\n'))
      write('ok.ts', ['a', '  // mutation-scope:x:start', 'b', 'c', '  // mutation-scope:x:end', 'd'])
      expect(markedMutationScopes(dir, [{ file: 'ok.ts', marker: 'x' }])).toEqual(['ok.ts:3-4'])
      write('missing.ts', ['// mutation-scope:x:start', 'b'])
      write('duplicate.ts', ['// mutation-scope:x:start', 'b', '// mutation-scope:x:end', '// mutation-scope:x:start', 'c', '// mutation-scope:x:end'])
      write('reversed.ts', ['// mutation-scope:x:end', 'b', '// mutation-scope:x:start'])
      write('empty.ts', ['// mutation-scope:x:start', '// mutation-scope:x:end'])
      for (const file of ['missing.ts', 'duplicate.ts', 'reversed.ts', 'empty.ts']) {
        expect(() => markedMutationScopes(dir, [{ file, marker: 'x' }])).toThrow('mutation-scope marker pair')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('one package command selects every profile', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(Object.keys(pkg.scripts).filter(name => name.startsWith('mutation-test'))).toEqual(['mutation-test'])
    expect(pkg.scripts['mutation-test']).toContain('mutation-profile.ts')
    for (const profile of ['core', 'incremental', 'ascii', 'families', 'routes']) {
      expect(Object.keys(MUTATION_PROFILES)).toContain(profile)
    }
  })

  test('only the incremental profile has a break floor', () => {
    for (const [name, config] of Object.entries(MUTATION_PROFILES)) {
      expect({ name, hasBreakFloor: 'thresholds' in config }).toEqual({
        name,
        hasBreakFloor: name === 'incremental',
      })
    }
  })
})
