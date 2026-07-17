import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')

function mutationConfigPaths(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  return Object.entries(pkg.scripts)
    .filter(([name]) => name === 'mutation-test' || name.startsWith('mutation-test:'))
    .flatMap(([name, command]) => [
      ...(name === 'mutation-test' ? ['stryker.config.json'] : []),
      ...(command.match(/stryker(?:\.[\w.-]+)?\.config\.(?:json|mjs)/g) ?? []),
    ])
}

function scopedSource(spec: string): string {
  const match = /^(.*):(\d+)-(\d+)$/.exec(spec)
  if (!match) throw new Error(`invalid mutation range: ${spec}`)
  const [, file, startText, endText] = match
  return readFileSync(join(ROOT, file!), 'utf8')
    .split(/\r?\n/)
    .slice(Number(startText) - 1, Number(endText))
    .join('\n')
}

describe('mutation config policy', () => {
  test('focused scopes follow semantic markers', async () => {
    const route = (await import('../../stryker.route-certificates.config.mjs')).default
    expect(route.mutate).toHaveLength(2)
    expect(scopedSource(route.mutate[0]!)).toContain('const finalizeCertificate')
    expect(scopedSource(route.mutate[0]!)).toContain('return certificates')
    expect(scopedSource(route.mutate[1]!)).toContain('ROUTE_STALE_AFTER_NODE_MOVE')

    const subgraph = (await import('../../stryker.subgraph-routing.config.mjs')).default
    expect(subgraph.mutate).toHaveLength(2)
    expect(scopedSource(subgraph.mutate[0]!)).toContain('const endpointSubgraph')
    expect(scopedSource(subgraph.mutate[0]!)).toContain('crossHierarchyEdges.push')
    expect(scopedSource(subgraph.mutate[1]!)).toContain('function deepestCommonAncestor')

    const links = (await import('../../stryker.link-grammar.config.mjs')).default
    expect(links.mutate).toHaveLength(3)
    expect(scopedSource(links.mutate[0]!)).toContain('extraOpen')
    expect(scopedSource(links.mutate[0]!)).toContain('extraClose')
    expect(scopedSource(links.mutate[0]!)).toContain('Math.max(extraOpen, extraClose)')
    expect(scopedSource(links.mutate[1]!)).toContain("classes[i] === 'feedback'")
    expect(scopedSource(links.mutate[1]!)).toContain('edge.target, target: edge.source')
    expect(scopedSource(links.mutate[2]!)).toContain('moveSet(separationUnit(ahead.id, behind.id)')
  })

  test('package scripts reference real configs', () => {
    const configs = mutationConfigPaths()
    expect(configs.length).toBeGreaterThan(0)
    for (const config of configs) expect({ config, exists: existsSync(join(ROOT, config)) }).toEqual({ config, exists: true })
  })

  test('broad route and family configs remain diagnostic rather than score gates', () => {
    const scoreGates = new Set(['stryker.incremental.config.json'])
    const configs = mutationConfigPaths()
      .filter(config => !scoreGates.has(config))
    for (const config of configs) {
      expect({ config, hasBreakFloor: /\bthresholds\s*[":]/.test(readFileSync(join(ROOT, config), 'utf8')) })
        .toEqual({ config, hasBreakFloor: false })
    }
  })
})
