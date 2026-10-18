import '../index.ts'
import { describe, expect, test } from 'bun:test'
import { certifyLayoutCandidates, LayoutCertificationError, MAX_LAYOUT_CANDIDATES } from '../layout/certification.ts'
import { LayoutMetricBudgetError } from '../layout/pass.ts'
import { DiagramWorkLimitError } from '../shared/diagram-limits.ts'
import { LAYOUT_PIPELINE, layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import { resolveRenderStyle } from '../styles.ts'
import { positionedToRenderedLayout } from '../agent/layout-to-rendered.ts'
import { graphTextBlock } from '../graph-text.ts'
import type { PositionedGraph } from '../types.ts'

const source = 'flowchart LR\nA -- first --> B\nB -- second --> A'

describe('bounded final layout certification', () => {
  test('a failing primary producer is contained inside the public fallback budget', () => {
    const firstPass = LAYOUT_PIPELINE[0]!
    const run = firstPass.run
    let calls = 0
    firstPass.run = context => {
      if (++calls === 1) throw new Error('primary geometry producer failed')
      run(context)
    }
    try {
      const positioned = layoutGraphSync(parseMermaid('flowchart LR\nA --> B'))
      expect(calls).toBe(2)
      expect(positioned.certification).toEqual({ status: 'passed', strategy: 'separate-hierarchy', attempts: 2, hardViolations: 0 })
      expect(positioned.nodes.map(node => node.id).sort()).toEqual(['A', 'B'])
    } finally {
      firstPass.run = run
    }
  })

  test('the public layout certifies actual styled label geometry', () => {
    const request = resolveRenderRequestForExecution(source, { style: { roles: { edge: { fontSize: 24 } } } }, 'svg')
    const { positioned } = positionResolvedFamily('flowchart', request) as { positioned: PositionedGraph }
    expect(positioned.certification?.status).toBe('passed')
    expect(positioned.certification?.hardViolations).toBe(0)
    expect(positioned.certification!.attempts).toBeLessThanOrEqual(MAX_LAYOUT_CANDIDATES)
    expect(positioned.edges.every(edge => edge.labelBlock?.fontSize === 24)).toBe(true)
  })

  test('an invalid first route yields to a certified deterministic alternative', () => {
    const graph = parseMermaid(source)
    const clean = layoutGraphSync(graph)
    const invalid = structuredClone(clean)
    invalid.edges[0]!.points = []
    const selected = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      { strategy: 'missing-route', produce: () => invalid },
      { strategy: 'clean', produce: () => clean },
    ])
    expect(selected.certification).toEqual({ status: 'passed', strategy: 'clean', attempts: 2, hardViolations: 0 })
    expect(selected.edges[0]!.points.length).toBeGreaterThanOrEqual(2)
  })

  test('no candidate succeeds on non-finite geometry, even when an outline checker could miss it', () => {
    const graph = parseMermaid('flowchart LR\nA --> B')
    const invalid = layoutGraphSync(graph)
    invalid.nodes[0]!.x = Number.NaN
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'invalid', produce: () => invalid }])).toThrow(LayoutCertificationError)
  })

  test.each(['labelBlock', 'labelPosition'] as const)('a visible edge label requires retained %s before certification', field => {
    const graph = parseMermaid(source)
    const invalid = layoutGraphSync(graph)
    delete invalid.edges[0]![field]
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'missing-label-geometry', produce: () => invalid }])).toThrow(/missing retained geometry/)
  })

  test.each(['node', 'edge', 'marker', 'label', 'node-label', 'group-label', 'parent'] as const)('a candidate cannot pass by losing or changing an authored %s', field => {
    const graph = parseMermaid('flowchart LR\nsubgraph S\nA -- meaningful --> B\nend')
    const invalid = layoutGraphSync(graph)
    if (field === 'node') invalid.nodes.pop()
    if (field === 'edge') invalid.edges.pop()
    if (field === 'marker') invalid.edges[0]!.hasArrowEnd = false
    if (field === 'label') invalid.edges[0]!.label = 'changed'
    if (field === 'node-label') invalid.nodes[0]!.label = 'changed'
    if (field === 'group-label') invalid.groups[0]!.label = 'changed'
    if (field === 'parent') invalid.groups = []
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'lost-content', produce: () => invalid }])).toThrow(LayoutCertificationError)
  })

  test('a candidate cannot exchange authored members between intact group frames', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[Left]\nA[Alpha]\nend\nsubgraph T[Right]\nB[Beta]\nend')
    const invalid = layoutGraphSync(graph)
    const a = invalid.nodes.find(node => node.id === 'A')!
    const b = invalid.nodes.find(node => node.id === 'B')!
    const { x, y } = a
    a.x = b.x
    a.y = b.y
    b.x = x
    b.y = y
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'exchanged-members', produce: () => invalid }])).toThrow(/member|ownership/)
  })

  test('public group membership retains authored identities instead of inferring ownership from coordinates', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[Left]\nA[Alpha]\nend\nsubgraph T[Right]\nB[Beta]\nend')
    const positioned = layoutGraphSync(graph)
    const a = positioned.nodes.find(node => node.id === 'A')!
    const b = positioned.nodes.find(node => node.id === 'B')!
    const { x, y } = a
    a.x = b.x
    a.y = b.y
    b.x = x
    b.y = y
    const view = positionedToRenderedLayout(positioned, 'flowchart')
    expect(view.groups.map(group => [group.id, group.members])).toEqual([['S', ['A']], ['T', ['B']]])
  })

  test.each(['node', 'group', 'edge'] as const)('a retained %s text block cannot replace the authored label', kind => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[Alpha]\nA[Alpha] -- Alpha --> B[Beta]\nend')
    const invalid = layoutGraphSync(graph)
    const style = resolveRenderStyle({})
    const owner = kind === 'node' ? invalid.nodes[0]! : kind === 'group' ? invalid.groups[0]! : invalid.edges[0]!
    owner.labelBlock = graphTextBlock('Zebra', style, kind)
    expect(() => certifyLayoutCandidates(graph, style, [{ strategy: 'changed-painted-text', produce: () => invalid }])).toThrow(/retained.*text|prepared.*text/)
  })

  test('retained formatted and transformed labels preserve their authored source', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[<b>Outer</b>]\nA[<i>Alpha</i>] -- mixed case --> B[Beta]\nend')
    const request = resolveRenderRequestForExecution('flowchart LR\nA --> B', { style: { roles: { node: { textTransform: 'uppercase' }, group: { textTransform: 'lowercase' }, edge: { textTransform: 'capitalize' } } } }, 'svg')
    const options = { styleFace: request.appearance.face }
    const style = resolveRenderStyle(options)
    const clean = layoutGraphSync(graph, options)
    expect(clean.nodes[0]!.labelBlock!.prepared.source).toBe('<i>Alpha</i>')
    expect(clean.nodes[0]!.labelBlock!.text).not.toBe(clean.nodes[0]!.label)
    expect(certifyLayoutCandidates(graph, style, [{ strategy: 'styled', produce: () => clean }]).certification?.status).toBe('passed')
  })

  test.each(['display', 'transform'] as const)('retained text cannot change its prepared %s interpretation', field => {
    const graph = parseMermaid('flowchart LR\nA[<b>Alpha</b>] --> B')
    const invalid = layoutGraphSync(graph)
    const block = invalid.nodes[0]!.labelBlock!
    invalid.nodes[0]!.labelBlock = { ...block, prepared: { ...block.prepared, [field]: field === 'display' ? 'literal' : 'uppercase' } }
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'changed-interpretation', produce: () => invalid }])).toThrow(/prepared.*text/)
  })

  test('an authored child frame cannot escape its parent with its members', () => {
    const graph = parseMermaid('flowchart LR\nsubgraph S[Outer]\nsubgraph T[Inner]\nA[Alpha]\nend\nend')
    const invalid = layoutGraphSync(graph)
    const outer = invalid.groups[0]!, inner = outer.children[0]!
    const dx = outer.x + outer.width + 30 - inner.x
    inner.x += dx
    invalid.nodes[0]!.x += dx
    invalid.width = inner.x + inner.width + 30
    expect(() => certifyLayoutCandidates(graph, resolveRenderStyle({}), [{ strategy: 'escaped-child', produce: () => invalid }])).toThrow(/parent|contain/)
  })

  test('exhaustion stops after four attempts and never returns the least-bad candidate', () => {
    const graph = parseMermaid('flowchart LR\nA --> B')
    const invalid = layoutGraphSync(graph)
    invalid.edges[0]!.points = []
    let calls = 0
    const candidates = Array.from({ length: MAX_LAYOUT_CANDIDATES + 3 }, (_, index) => ({
      strategy: `attempt-${index}`,
      produce: () => {
        calls++
        return invalid
      },
    }))
    let failure: LayoutCertificationError | undefined
    try {
      certifyLayoutCandidates(graph, resolveRenderStyle({}), candidates)
    } catch (error) {
      if (error instanceof LayoutCertificationError) failure = error
      else throw error
    }
    expect(calls).toBe(4)
    expect(failure?.attempts).toHaveLength(4)
    expect(failure?.attempts.every(attempt => attempt.violations.some(violation => violation.includes('missing route')))).toBe(true)
  })

  test('a title preference preflight exception stays inside its candidate attempt', () => {
    const graph = parseMermaid(source)
    const clean = layoutGraphSync(graph)
    let calls = 0
    const positioned = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      {
        strategy: 'preflight-fails',
        produce: () => {
          calls++
          return clean
        },
        preferNext: () => {
          throw new Error('title fit failed')
        },
      },
      {
        strategy: 'alternative',
        produce: () => {
          calls++
          return clean
        },
      },
    ])
    expect(calls).toBe(2)
    expect(positioned.certification?.strategy).toBe('alternative')
    expect(positioned.certification?.attempts).toBe(2)
  })

  test('a certified title fallback survives an invalid preferred alternative without an extra production', () => {
    const graph = parseMermaid(source)
    const clean = layoutGraphSync(graph)
    const invalid = structuredClone(clean)
    invalid.edges[0]!.points = []
    let calls = 0
    const positioned = certifyLayoutCandidates(graph, resolveRenderStyle({}), [
      {
        strategy: 'default',
        produce: () => {
          calls++
          return clean
        },
        preferNext: () => true,
      },
      {
        strategy: 'preferred',
        produce: () => {
          calls++
          return invalid
        },
      },
      {
        strategy: 'unused',
        produce: () => {
          calls++
          return clean
        },
      },
    ])
    expect(calls).toBe(2)
    expect(positioned.certification).toEqual({ status: 'passed', strategy: 'default', attempts: 2, hardViolations: 0 })
  })

  test.each([
    new LayoutMetricBudgetError('straighten', 'bends', 0, 4, 2),
    new DiagramWorkLimitError('nodes', 5_001),
  ])('a non-recoverable %s cannot be hidden by an otherwise clean fallback', error => {
    const graph = parseMermaid(source)
    const clean = layoutGraphSync(graph)
    let alternateCalls = 0
    expect(() =>
      certifyLayoutCandidates(graph, resolveRenderStyle({}), [
        {
          strategy: 'budget-fails',
          produce: () => {
            throw error
          },
        },
        {
          strategy: 'clean',
          produce: () => {
            alternateCalls++
            return clean
          },
        },
      ]),
    ).toThrow(error)
    expect(alternateCalls).toBe(0)
  })
})
