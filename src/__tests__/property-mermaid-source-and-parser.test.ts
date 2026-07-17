import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { mergeMermaidConfigs, normalizeMermaidSource, type MermaidRuntimeConfig } from '../mermaid-source.ts'
import { parseMermaid } from '../parser.ts'
import type { MermaidGraph, MermaidNode } from '../types.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

const PROPERTY_RUNS = 60
const ID_HEAD = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
const ID_TAIL = [...'abcdefghijklmnopqrstuvwxyz0123456789-']
const WORD_CHARS = [...'abcdefghijklmnopqrstuvwxyz']

const idArb = fc
  .tuple(
    fc.constantFrom(...ID_HEAD),
    fc.array(fc.constantFrom(...ID_TAIL), { maxLength: 5 }),
  )
  .map(([head, tail]) => `${head}${tail.join('')}`)

const wordArb = fc
  .array(fc.constantFrom(...WORD_CHARS), { minLength: 1, maxLength: 8 })
  .map(chars => chars.join(''))

const labelArb = fc
  .array(wordArb, { minLength: 1, maxLength: 3 })
  .map(parts => parts.join(' '))

const nodeShapeArb = fc.constantFrom<'rectangle' | 'rounded' | 'diamond'>('rectangle', 'rounded', 'diamond')

const nodeDefArb = fc.record({
  id: idArb,
  label: labelArb,
  shape: nodeShapeArb,
})

const runtimeConfigArb = fc.record({
  theme: fc.option(fc.constantFrom('dark', 'forest', 'neutral'), { nil: undefined }),
  fontFamily: fc.option(fc.constantFrom('Fira Code', 'IBM Plex Mono', 'Menlo'), { nil: undefined }),
  primaryTextColor: fc.option(fc.constantFrom('#111111', '#fafafa', '#0ea5e9'), { nil: undefined }),
  disableMulticolor: fc.option(fc.boolean(), { nil: undefined }),
})

function renderNodeDefinition(node: { id: string; label: string; shape: 'rectangle' | 'rounded' | 'diamond' }): string {
  if (node.shape === 'rounded') return `${node.id}(${node.label})`
  if (node.shape === 'diamond') return `${node.id}{${node.label}}`
  return `${node.id}[${node.label}]`
}

function normalizeGraph(graph: MermaidGraph): Record<string, unknown> {
  return {
    direction: graph.direction,
    nodes: [...graph.nodes.values()].map(node => ({
      id: node.id,
      label: node.label,
      shape: node.shape,
    })),
    edges: graph.edges.map(edge => ({
      source: edge.source,
      target: edge.target,
      label: edge.label,
      style: edge.style,
      hasArrowStart: edge.hasArrowStart,
      hasArrowEnd: edge.hasArrowEnd,
    })),
    subgraphs: graph.subgraphs.map(subgraph => ({
      id: subgraph.id,
      label: subgraph.label,
      nodeIds: [...subgraph.nodeIds],
      direction: subgraph.direction,
      children: subgraph.children.map(child => ({
        id: child.id,
        label: child.label,
        nodeIds: [...child.nodeIds],
      })),
    })),
    classDefs: [...graph.classDefs.entries()].sort(([a], [b]) => compareCodePointStrings(a, b)),
    classAssignments: [...graph.classAssignments.entries()].sort(([a], [b]) => compareCodePointStrings(a, b)),
    nodeStyles: [...graph.nodeStyles.entries()].sort(([a], [b]) => compareCodePointStrings(a, b)),
    linkStyles: [...graph.linkStyles.entries()].sort(([a], [b]) => compareCodePointStrings(String(a), String(b))),
  }
}

function addWhitespaceAndComments(source: string): string {
  return source
    .split('\n')
    .flatMap((line, index, lines) => {
      const padded = index % 2 === 0 ? `  ${line}  ` : `\t${line}\t`
      if (index === lines.length - 1) return [padded]
      return [padded, index % 2 === 0 ? '' : `%% ignored ${index}`]
    })
    .join('\n')
}

function makeRuntimeConfig(input: {
  theme?: string
  fontFamily?: string
  primaryTextColor?: string
  disableMulticolor?: boolean
}): MermaidRuntimeConfig {
  const config: MermaidRuntimeConfig = {}
  if (input.theme) config.theme = input.theme
  if (input.fontFamily) config.fontFamily = input.fontFamily
  if (input.primaryTextColor) config.themeVariables = { primaryTextColor: input.primaryTextColor }
  if (input.disableMulticolor !== undefined) config.timeline = { disableMulticolor: input.disableMulticolor }
  return config
}

function yamlLinesForConfig(config: MermaidRuntimeConfig): string[] {
  const lines: string[] = []
  if (config.theme) lines.push(`theme: "${config.theme}"`)
  if (config.fontFamily) lines.push(`fontFamily: "${config.fontFamily}"`)
  if (config.themeVariables?.primaryTextColor) {
    lines.push('themeVariables:')
    lines.push(`  primaryTextColor: "${config.themeVariables.primaryTextColor}"`)
  }
  if (config.timeline?.disableMulticolor !== undefined) {
    lines.push('timeline:')
    lines.push(`  disableMulticolor: ${config.timeline.disableMulticolor}`)
  }
  return lines
}

describe('property-based mermaid source normalization', () => {
  it('merges base config, frontmatter, and init directives while preserving body lines', () => {
    const configArb = fc.record({
      base: runtimeConfigArb,
      frontmatter: runtimeConfigArb,
      directive: runtimeConfigArb,
    })

    fc.assert(
      fc.property(configArb, ({ base, frontmatter, directive }) => {
        const baseConfig = makeRuntimeConfig(base)
        const frontmatterConfig = makeRuntimeConfig(frontmatter)
        const directiveConfig = makeRuntimeConfig(directive)

        const sourceLines: string[] = []
        const frontmatterLines = yamlLinesForConfig(frontmatterConfig)
        if (frontmatterLines.length > 0) {
          sourceLines.push('---', ...frontmatterLines, '---')
        }

        const directiveJson = JSON.stringify(directiveConfig)
        if (directiveJson !== '{}') {
          sourceLines.push(`%%{init: ${directiveJson}}%%`)
        }

        sourceLines.push('%% comment')
        sourceLines.push('graph TD')
        sourceLines.push('A --> B')

        const normalized = normalizeMermaidSource(sourceLines.join('\n'), baseConfig)

        expect(normalized.text).toBe('graph TD\nA --> B')
        expect(normalized.lines).toEqual(['graph TD', 'A --> B'])
        expect(normalized.config).toEqual(
          mergeMermaidConfigs(baseConfig, frontmatterConfig, directiveConfig),
        )
      }),
      { numRuns: PROPERTY_RUNS },
    )
  })
})

describe('property-based parseMermaid', () => {
  // Pinned seed: unpinned runs made these properties CI seed-lotteries (the
  // Cartesian-product property above failed only on rare rolled seeds; 2026-07
  // audit). Pin at each assertion instead of mutating process-global state, so
  // the guarantee remains valid when this file and the policy epilogue land in
  // different Bun shards.
  const PARSER_PROPERTY_SEED = 20260702

  it('is invariant to blank lines, comments, and surrounding whitespace', () => {
    const graphArb = fc
      .uniqueArray(nodeDefArb, { minLength: 2, maxLength: 5, selector: node => node.id })
      .chain(nodes =>
        fc.record({
          nodes: fc.constant(nodes),
          edges: fc.uniqueArray(
            fc.record({
              from: fc.constantFrom(...nodes.map(node => node.id)),
              to: fc.constantFrom(...nodes.map(node => node.id)),
              label: fc.option(labelArb, { nil: undefined }),
            }).filter(edge => edge.from !== edge.to),
            {
              minLength: 1,
              maxLength: Math.min(6, nodes.length * (nodes.length - 1)),
              selector: edge => `${edge.from}->${edge.to}:${edge.label ?? ''}`,
            },
          ),
        }),
      )

    fc.assert(
      fc.property(graphArb, ({ nodes, edges }) => {
        const source = [
          'graph TD',
          ...nodes.map(renderNodeDefinition),
          ...edges.map(edge => `${edge.from} -->${edge.label ? `|${edge.label}|` : ''} ${edge.to}`),
        ].join('\n')

        expect(normalizeGraph(parseMermaid(addWhitespaceAndComments(source)))).toEqual(
          normalizeGraph(parseMermaid(source)),
        )
      }),
      { numRuns: PROPERTY_RUNS, seed: PARSER_PROPERTY_SEED },
    )
  })

  it('materializes the Cartesian product for parallel link groups', () => {
    // Avoid IDs containing repeated hyphens anywhere: `s---Py3 --> X` is
    // grammar-ambiguous with Mermaid's link forms (`s --- Py3` is an open
    // link, `N--x` a cross-tip link), so such strings are not unambiguously
    // ids in the grammar and the parser materializes the link reading — in
    // both this engine and Mermaid. The old trailing-only filter (`-{2,}$`)
    // let interior runs through, which made this property a seed lottery
    // (2026-07 audit: it failed CI on the first rolled seed that generated
    // one). This property targets unambiguous `&` fanout/fanin only.
    const fanoutIdArb = idArb.filter(id => !/-{2,}/.test(id))
    const parallelArb = fc.record({
      left: fc.uniqueArray(fanoutIdArb, { minLength: 1, maxLength: 3 }),
      right: fc.uniqueArray(fanoutIdArb, { minLength: 1, maxLength: 3 }),
    }).filter(({ left, right }) => left.every(id => !right.includes(id)))

    fc.assert(
      fc.property(parallelArb, ({ left, right }) => {
        const source = `graph TD\n${left.join(' & ')} --> ${right.join(' & ')}`
        const graph = parseMermaid(source)
        const edgePairs = new Set(graph.edges.map(edge => `${edge.source}->${edge.target}`))

        expect(graph.edges).toHaveLength(left.length * right.length)
        for (const from of left) {
          for (const to of right) {
            expect(edgePairs.has(`${from}->${to}`)).toBe(true)
          }
        }
      }),
      { numRuns: PROPERTY_RUNS, seed: PARSER_PROPERTY_SEED },
    )
  })

  it('always produces edges whose endpoints exist as nodes', () => {
    const graphArb = fc
      .uniqueArray(nodeDefArb, { minLength: 2, maxLength: 5, selector: node => node.id })
      .chain(nodes =>
        fc.record({
          nodes: fc.constant(nodes),
          edges: fc.uniqueArray(
            fc.record({
              from: fc.constantFrom(...nodes.map(node => node.id)),
              to: fc.constantFrom(...nodes.map(node => node.id)),
              label: fc.option(labelArb, { nil: undefined }),
            }),
            {
              minLength: 1,
              maxLength: 6,
              selector: edge => `${edge.from}->${edge.to}:${edge.label ?? ''}`,
            },
          ),
        }),
      )

    fc.assert(
      fc.property(graphArb, ({ nodes, edges }) => {
        const source = [
          'graph TD',
          ...nodes.map(renderNodeDefinition),
          ...edges.map(edge => `${edge.from} -->${edge.label ? `|${edge.label}|` : ''} ${edge.to}`),
        ].join('\n')

        const graph = parseMermaid(source)

        for (const edge of graph.edges) {
          expect(graph.nodes.has(edge.source)).toBe(true)
          expect(graph.nodes.has(edge.target)).toBe(true)
        }
      }),
      { numRuns: PROPERTY_RUNS, seed: PARSER_PROPERTY_SEED },
    )
  })
})
