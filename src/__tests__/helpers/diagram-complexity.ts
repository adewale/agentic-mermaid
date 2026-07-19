import { layoutMermaid } from '../../agent/core.ts'
import { parseRegisteredMermaid } from '../../agent/parse.ts'
import type { RenderedLayout } from '../../agent/types.ts'
import { visualWidth } from '../../ascii/width.ts'
import { compareCodePointStrings } from '../../shared/deterministic-order.ts'

export interface DiagramComplexity {
  readonly entities: number
  readonly relations: number
  readonly nestingDepth: number
  readonly parallelEdges: number
  readonly reciprocalEdges: number
  readonly cycles: number
  readonly authoredTextCells: number
  readonly maxLabelCells: number
  readonly unicodeClasses: readonly string[]
  readonly activeConfigFields: number
  readonly semanticFeatureTags: readonly string[]
}

export interface RenderedComplexity {
  readonly marks: number
  readonly routePoints: number
  readonly width: number
  readonly height: number
}

export interface ComplexityMeasurement {
  readonly source: DiagramComplexity
  readonly rendered: RenderedComplexity
}

function unicodeClasses(text: string): string[] {
  const classes = new Set<string>()
  if (/[^\x00-\x7f]/u.test(text)) classes.add('non-ascii')
  if (/\p{Mark}/u.test(text)) classes.add('combining-mark')
  if (/\p{Extended_Pictographic}/u.test(text)) classes.add('emoji')
  if (/\u200d/u.test(text)) classes.add('zwj')
  if (/[\u0590-\u08ff]/u.test(text)) classes.add('rtl-script')
  if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(text)) classes.add('cjk')
  return [...classes].sort(compareCodePointStrings)
}

function graphMetrics(layout: RenderedLayout): Pick<DiagramComplexity, 'parallelEdges' | 'reciprocalEdges' | 'cycles'> {
  const directedCounts = new Map<string, number>()
  const adjacency = new Map<string, Set<string>>()
  for (const edge of layout.edges) {
    const key = `${edge.from}\0${edge.to}`
    directedCounts.set(key, (directedCounts.get(key) ?? 0) + 1)
    const targets = adjacency.get(edge.from) ?? new Set<string>()
    targets.add(edge.to)
    adjacency.set(edge.from, targets)
  }
  const parallelEdges = [...directedCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  let reciprocalEdges = 0
  for (const key of directedCounts.keys()) {
    const [from, to] = key.split('\0') as [string, string]
    if (compareCodePointStrings(from, to) < 0 && directedCounts.has(`${to}\0${from}`)) reciprocalEdges++
  }

  let cycles = 0
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (node: string): void => {
    if (visited.has(node)) return
    visiting.add(node)
    for (const target of adjacency.get(node) ?? []) {
      if (visiting.has(target)) cycles++
      else visit(target)
    }
    visiting.delete(node)
    visited.add(node)
  }
  for (const node of [...adjacency.keys()].sort(compareCodePointStrings)) visit(node)
  return { parallelEdges, reciprocalEdges, cycles }
}

function maximumGroupDepth(layout: RenderedLayout): number {
  const parent = new Map(layout.groups.map(group => [group.id, group.parentId]))
  let maximum = 0
  for (const group of layout.groups) {
    let depth = 1
    let current = group.parentId
    const seen = new Set([group.id])
    while (current && !seen.has(current)) {
      seen.add(current)
      depth++
      current = parent.get(current)
    }
    maximum = Math.max(maximum, depth)
  }
  return maximum
}

function activeConfigFieldCount(source: string): number {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(source)?.[1]
  if (!frontmatter) return 0
  return frontmatter.split(/\r?\n/u)
    .filter(line => /^\s*[A-Za-z_][\w-]*\s*:/u.test(line) && !/^\s*(?:config|themeVariables)\s*:\s*$/u.test(line))
    .length
}

function semanticTags(source: string, layout: RenderedLayout, metrics: ReturnType<typeof graphMetrics>): string[] {
  const tags = new Set<string>()
  if (layout.groups.length > 0) tags.add('groups')
  if (maximumGroupDepth(layout) > 1) tags.add('nested-groups')
  if (metrics.parallelEdges > 0) tags.add('parallel-edges')
  if (metrics.reciprocalEdges > 0) tags.add('reciprocal-edges')
  if (metrics.cycles > 0) tags.add('cycles')
  const tokenTags: Array<[RegExp, string]> = [
    [/\b(?:click|link)\b/u, 'external-reference-syntax'],
    [/\b(?:classDef|style|themeVariables)\b/u, 'authored-style'],
    [/\b(?:note|accTitle|accDescr)\b/u, 'annotation'],
    [/\b(?:alt|opt|loop|par|critical)\b/u, 'control-structure'],
    [/\b(?:subgraph|namespace|section|group)\b/u, 'container-syntax'],
    [/\b(?:icon|image|::icon)\b/u, 'resource-syntax'],
  ]
  for (const [pattern, tag] of tokenTags) if (pattern.test(source)) tags.add(tag)
  return [...tags].sort(compareCodePointStrings)
}

export function measureDiagramComplexity(source: string): ComplexityMeasurement {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok || parsed.value.body.kind === 'opaque') {
    throw new Error(`Complexity source must parse as structured: ${parsed.ok ? parsed.value.kind : parsed.error[0]?.message ?? 'unknown error'}`)
  }
  const layout = layoutMermaid(parsed.value)
  const labels = [
    ...layout.nodes.map(node => node.label ?? ''),
    ...layout.edges.map(edge => edge.label?.text ?? ''),
    ...layout.groups.map(group => group.label ?? ''),
  ]
  const widths = labels.map(visualWidth)
  const authoredWidths = source.split(/\r?\n/u).map(visualWidth)
  const graph = graphMetrics(layout)
  return {
    source: {
      entities: layout.nodes.length,
      relations: layout.edges.length,
      nestingDepth: maximumGroupDepth(layout),
      parallelEdges: graph.parallelEdges,
      reciprocalEdges: graph.reciprocalEdges,
      cycles: graph.cycles,
      authoredTextCells: authoredWidths.reduce((sum, width) => sum + width, 0),
      maxLabelCells: Math.max(0, ...widths),
      unicodeClasses: unicodeClasses(source),
      activeConfigFields: activeConfigFieldCount(source),
      semanticFeatureTags: semanticTags(source, layout, graph),
    },
    rendered: {
      marks: layout.nodes.length + layout.edges.length + layout.groups.length,
      routePoints: layout.edges.reduce((sum, edge) => sum + edge.path.length, 0),
      width: layout.bounds.w,
      height: layout.bounds.h,
    },
  }
}
