import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MUTATION_PROFILES } from '../../stryker.config.mjs'

const ROOT = join(import.meta.dir, '..', '..')

function scopedSource(spec: string): string {
  const match = /^(.*):(\d+)-(\d+)$/.exec(spec)
  if (!match) throw new Error(`invalid mutation range: ${spec}`)
  const [, file, startText, endText] = match
  return readFileSync(join(ROOT, file!), 'utf8')
    .split(/\r?\n/)
    .slice(Number(startText) - 1, Number(endText))
    .join('\n')
}

describe('mutation profile policy', () => {
  test('focused scopes follow semantic markers', () => {
    const route = MUTATION_PROFILES['routes:certs']
    expect(route.mutate).toHaveLength(2)
    expect(scopedSource(route.mutate[0]!)).toContain('const finalizeCertificate')
    expect(scopedSource(route.mutate[1]!)).toContain('ROUTE_STALE_AFTER_NODE_MOVE')

    const subgraph = MUTATION_PROFILES['routes:subgraph']
    expect(scopedSource(subgraph.mutate[0]!)).toContain('crossHierarchyEdges.push')
    expect(scopedSource(subgraph.mutate[1]!)).toContain('function deepestCommonAncestor')

    const links = MUTATION_PROFILES.links
    expect(links.mutate).toHaveLength(3)
    expect(scopedSource(links.mutate[0]!)).toContain('Math.max(extraOpen, extraClose)')
    expect(scopedSource(links.mutate[1]!)).toContain("classes[i] === 'feedback'")
    expect(scopedSource(links.mutate[2]!)).toContain('moveSet(separationUnit(ahead.id, behind.id)')
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
