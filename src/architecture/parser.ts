import type { MermaidGraph, MermaidSubgraph, Direction } from '../types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { ALIGN_DIRECTIVE_RE, parseAlignDirective } from './align.ts'
import type { ArchitectureAlignment } from './align.ts'
import type {
  ArchitectureChildRef,
  ArchitectureDiagram,
  ArchitectureEdge,
  ArchitectureEndpoint,
  ArchitectureGroup,
  ArchitectureJunction,
  ArchitectureService,
} from './types.ts'

// ============================================================================
// Mermaid architecture-beta parser
//
// Supported statements:
//   architecture-beta
//   title Visible diagram heading
//   group id(icon)[Label] in parent
//   service id(icon)[Label] in group
//   junction id in group
//   serviceId:R --> L:otherService
//   serviceId{group}:R -[label]-> L:otherService
//   align row|column id id ...     (parsed + preserved; see align.ts)
// ============================================================================

const IDENT = '[\\w-]+'
const ICON = '\\(([^)]+)\\)'
const LABEL = '\\[(.+)\\]'

const GROUP_RE = new RegExp(`^group\\s+(${IDENT})(?:${ICON})?(?:${LABEL})?(?:\\s+in\\s+(${IDENT}))?\\s*$`)
const SERVICE_RE = new RegExp(`^service\\s+(${IDENT})(?:${ICON})?(?:${LABEL})?(?:\\s+in\\s+(${IDENT}))?\\s*$`)
const JUNCTION_RE = new RegExp(`^junction\\s+(${IDENT})(?:\\s+in\\s+(${IDENT}))?\\s*$`)
const SOURCE_RE = new RegExp(`^(${IDENT})(\\{group\\})?:(L|R|T|B)$`)
const TARGET_RE = new RegExp(`^(L|R|T|B):(${IDENT})(\\{group\\})?$`)

export function parseArchitectureDiagram(lines: string[]): ArchitectureDiagram {
  if (lines.length === 0) {
    throw new Error('Empty mermaid diagram')
  }

  if (!/^architecture(?:-beta)?\s*$/i.test(lines[0]!)) {
    throw new Error(`Invalid mermaid header: "${lines[0]}". Expected "architecture" or "architecture-beta".`)
  }

  const groups = new Map<string, ArchitectureGroup>()
  const services = new Map<string, ArchitectureService>()
  const junctions = new Map<string, ArchitectureJunction>()
  const rootChildren: ArchitectureChildRef[] = []
  const edges: ArchitectureEdge[] = []
  const alignments: ArchitectureAlignment[] = []
  let title: string | undefined
  let accessibilityTitle: string | undefined
  let accessibilityDescription: string | undefined

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!

    const titleMatch = line.match(/^title\s+(.+)$/i)
    if (titleMatch) {
      title = normalizeBrTags(titleMatch[1]!.trim())
      continue
    }

    const accTitleMatch = line.match(/^accTitle\s*:\s*(.+)$/i)
    if (accTitleMatch) {
      accessibilityTitle = normalizeBrTags(accTitleMatch[1]!.trim())
      continue
    }

    const accDescrBlockMatch = line.match(/^accDescr\s*:?\s*\{\s*(.*)$/i)
    if (accDescrBlockMatch) {
      const blockLines: string[] = []
      if (accDescrBlockMatch[1]!.trim()) blockLines.push(accDescrBlockMatch[1]!.trim())
      let closed = false
      for (i++; i < lines.length; i++) {
        const blockLine = lines[i]!
        if (blockLine.includes('}')) {
          const before = blockLine.slice(0, blockLine.indexOf('}')).trim()
          if (before) blockLines.push(before)
          closed = true
          break
        }
        blockLines.push(blockLine)
      }
      if (!closed) throw new Error('Unterminated accDescr block — missing closing "}"')
      accessibilityDescription = normalizeBrTags(blockLines.join('\n').trim())
      continue
    }

    const accDescrMatch = line.match(/^accDescr\s*:\s*(.+)$/i)
    if (accDescrMatch) {
      accessibilityDescription = normalizeBrTags(accDescrMatch[1]!.trim())
      continue
    }

    const groupMatch = line.match(GROUP_RE)
    if (groupMatch) {
      const id = groupMatch[1]!
      const icon = groupMatch[2]?.trim() || undefined
      const label = normalizeBrTags(groupMatch[3] ?? id)
      const parentId = groupMatch[4] ?? undefined
      ensureIdentifierAvailable(id, groups, services, junctions)
      const group: ArchitectureGroup = { id, label, icon, parentId, children: [] }
      ensureParentGroup(parentId, groups, line)
      groups.set(id, group)
      attachChild({ kind: 'group', id }, parentId, groups, rootChildren)
      continue
    }

    const serviceMatch = line.match(SERVICE_RE)
    if (serviceMatch) {
      const id = serviceMatch[1]!
      const icon = serviceMatch[2]?.trim() || undefined
      const label = normalizeBrTags(groupMatchSafe(serviceMatch[3], id))
      const parentId = serviceMatch[4] ?? undefined
      ensureIdentifierAvailable(id, groups, services, junctions)
      const service: ArchitectureService = { id, label, icon, parentId }
      ensureParentGroup(parentId, groups, line)
      services.set(id, service)
      attachChild({ kind: 'service', id }, parentId, groups, rootChildren)
      continue
    }

    const junctionMatch = line.match(JUNCTION_RE)
    if (junctionMatch) {
      const id = junctionMatch[1]!
      const parentId = junctionMatch[2] ?? undefined
      ensureIdentifierAvailable(id, groups, services, junctions)
      const junction: ArchitectureJunction = { id, parentId }
      ensureParentGroup(parentId, groups, line)
      junctions.set(id, junction)
      attachChild({ kind: 'junction', id }, parentId, groups, rootChildren)
      continue
    }

    // `align` is a reserved word upstream, so a leading `align` token is
    // always a directive — never an edge whose source happens to be named
    // "align" (edge endpoints carry a `:SIDE` suffix and do not match).
    if (ALIGN_DIRECTIVE_RE.test(line)) {
      alignments.push(parseAlignmentLine(line, groups, services, junctions))
      continue
    }

    edges.push(parseArchitectureEdge(line, services, junctions))
  }

  return {
    title,
    groups: [...groups.values()],
    services: [...services.values()],
    junctions: [...junctions.values()],
    edges,
    alignments,
    rootChildren,
    accessibilityTitle,
    accessibilityDescription,
  }
}

/**
 * Parse + validate one `align row|column ...` directive (upstream v11.16.0).
 * Shape rules (axis keyword, ≥2 members, no duplicates) live in align.ts;
 * this adds the declaration checks upstream applies at the DB level: every
 * member must be an already-declared service or junction, never a group.
 */
function parseAlignmentLine(
  line: string,
  groups: Map<string, ArchitectureGroup>,
  services: Map<string, ArchitectureService>,
  junctions: Map<string, ArchitectureJunction>,
): ArchitectureAlignment {
  const parsed = parseAlignDirective(line)
  if (!parsed.ok) {
    throw syntaxError({
      what: `Invalid architecture align directive "${line}" — ${parsed.reason}`,
      expectedForm: 'align row|column memberA memberB ..., listing at least two distinct services or junctions',
      example: 'align row db1 db2 db3',
    })
  }
  for (const member of parsed.alignment.members) {
    if (services.has(member) || junctions.has(member)) continue
    if (groups.has(member)) {
      throw new Error(`Architecture align members must be services or junctions; "${member}" is a group in line "${line}"`)
    }
    throw syntaxError({
      what: `Unknown architecture align member "${member}" in line "${line}"`,
      expectedForm: 'a service or junction declared earlier',
      example: `service ${member}(server)[${member}]`,
      known: [...services.keys(), ...junctions.keys()],
    })
  }
  return parsed.alignment
}

function groupMatchSafe(value: string | undefined, fallback: string): string {
  return value ?? fallback
}

function ensureIdentifierAvailable(
  id: string,
  groups: Map<string, ArchitectureGroup>,
  services: Map<string, ArchitectureService>,
  junctions: Map<string, ArchitectureJunction>,
): void {
  if (groups.has(id) || services.has(id) || junctions.has(id)) {
    throw syntaxError({
      what: `Duplicate architecture identifier "${id}"`,
      expectedForm: 'a unique id for each service, group, and junction',
      example: `${id}2`,
      known: [...groups.keys(), ...services.keys(), ...junctions.keys()],
    })
  }
}

function ensureParentGroup(
  parentId: string | undefined,
  groups: Map<string, ArchitectureGroup>,
  line: string,
): void {
  if (parentId && !groups.has(parentId)) {
    throw syntaxError({
      what: `Unknown architecture group "${parentId}" in line "${line}"`,
      expectedForm: 'a group declared earlier with group id(icon)[Label]',
      example: `group ${parentId}(cloud)[${parentId}]`,
      known: [...groups.keys()],
    })
  }
}

function attachChild(
  child: ArchitectureChildRef,
  parentId: string | undefined,
  groups: Map<string, ArchitectureGroup>,
  rootChildren: ArchitectureChildRef[],
): void {
  if (parentId) {
    groups.get(parentId)!.children.push(child)
  } else {
    rootChildren.push(child)
  }
}

function parseArchitectureEdge(
  line: string,
  services: Map<string, ArchitectureService>,
  junctions: Map<string, ArchitectureJunction>,
): ArchitectureEdge {
  const match = line.match(/^(\S+)\s+(.+)\s+(\S+)$/)
  if (!match) {
    throw syntaxError({
      what: `Invalid architecture edge: "${line}"`,
      expectedForm: 'source:SIDE <op> SIDE:target, where SIDE is L, R, T, or B',
      example: 'api:R --> L:db',
    })
  }

  const source = parseSourceEndpoint(match[1]!)
  const target = parseTargetEndpoint(match[3]!)
  const { label, hasArrowStart, hasArrowEnd } = parseEdgeOperator(match[2]!)

  validateEndpoint(source, services, junctions, line)
  validateEndpoint(target, services, junctions, line)

  return { source, target, label, hasArrowStart, hasArrowEnd }
}

function parseSourceEndpoint(token: string): ArchitectureEndpoint {
  const match = token.trim().match(SOURCE_RE)
  if (!match) {
    throw new Error(`Invalid architecture edge source "${token}" — expected id then side, e.g. "api:R" in "api:R -- L:db"`)
  }

  return {
    id: match[1]!,
    boundary: match[2] ? 'group' : 'item',
    side: match[3] as ArchitectureEndpoint['side'],
  }
}

function parseTargetEndpoint(token: string): ArchitectureEndpoint {
  const match = token.trim().match(TARGET_RE)
  if (!match) {
    throw new Error(`Invalid architecture edge target "${token}" — expected side then id, e.g. "L:db" in "api:R -- L:db"`)
  }

  return {
    id: match[2]!,
    boundary: match[3] ? 'group' : 'item',
    side: match[1] as ArchitectureEndpoint['side'],
  }
}

function parseEdgeOperator(token: string): Pick<ArchitectureEdge, 'label' | 'hasArrowStart' | 'hasArrowEnd'> {
  const trimmed = token.trim()

  if (trimmed === '<-->') return { hasArrowStart: true, hasArrowEnd: true }
  if (trimmed === '-->') return { hasArrowStart: false, hasArrowEnd: true }
  if (trimmed === '<--') return { hasArrowStart: true, hasArrowEnd: false }
  if (trimmed === '--') return { hasArrowStart: false, hasArrowEnd: false }

  const labelMatch = trimmed.match(/^(<)?-\[(.*)\]-(>)?$/)
  if (!labelMatch) {
    throw syntaxError({
      what: `Invalid architecture edge operator "${token}"`,
      expectedForm: 'one of --, -->, <--, <-->, or -[label]-',
      example: 'api:R --> L:db',
    })
  }

  const label = normalizeBrTags(labelMatch[2] ?? '').trim() || undefined
  return {
    label,
    hasArrowStart: Boolean(labelMatch[1]),
    hasArrowEnd: Boolean(labelMatch[3]),
  }
}

function validateEndpoint(
  endpoint: ArchitectureEndpoint,
  services: Map<string, ArchitectureService>,
  junctions: Map<string, ArchitectureJunction>,
  line: string,
): void {
  const service = services.get(endpoint.id)
  const junction = junctions.get(endpoint.id)

  if (!service && !junction) {
    throw syntaxError({
      what: `Unknown architecture item "${endpoint.id}" in line "${line}"`,
      expectedForm: 'a service or junction declared earlier',
      example: `service ${endpoint.id}(server)[${endpoint.id}]`,
      known: [...services.keys(), ...junctions.keys()],
    })
  }

  if (endpoint.boundary === 'group') {
    if (!service) {
      throw new Error(`Architecture group boundary modifier only applies to services: "${line}"`)
    }
    if (!service.parentId) {
      throw new Error(`Service "${service.id}" is not inside a group, so "{group}" is invalid in line "${line}"`)
    }
  }
}

export function architectureToMermaidGraph(diagram: ArchitectureDiagram): MermaidGraph {
  const nodes = new Map<string, { id: string; label: string; shape: 'rectangle' | 'service' | 'state-start' }>()

  for (const service of diagram.services) {
    nodes.set(service.id, {
      id: service.id,
      label: service.label,
      shape: service.icon ? 'service' : 'rectangle',
    })
  }

  for (const junction of diagram.junctions) {
    nodes.set(junction.id, {
      id: junction.id,
      label: '',
      shape: 'state-start',
    })
  }

  const direction = detectArchitectureDirection(diagram.edges)

  return {
    direction,
    nodes,
    edges: diagram.edges.map((edge) => ({
      source: edge.source.id,
      target: edge.target.id,
      label: edge.label,
      style: 'solid',
      hasArrowStart: edge.hasArrowStart,
      hasArrowEnd: edge.hasArrowEnd,
    })),
    subgraphs: buildMermaidSubgraphs(diagram.groups),
    classDefs: new Map(),
    classAssignments: new Map(),
    nodeStyles: new Map(),
    linkStyles: new Map(),
  }
}

function buildMermaidSubgraphs(groups: ArchitectureGroup[]): MermaidSubgraph[] {
  const byId = new Map(groups.map((group) => [group.id, group]))

  function toMermaidSubgraph(group: ArchitectureGroup): MermaidSubgraph {
    const nodeIds: string[] = []
    const children: MermaidSubgraph[] = []

    for (const child of group.children) {
      if (child.kind === 'group') {
        const nested = byId.get(child.id)
        if (nested) children.push(toMermaidSubgraph(nested))
      } else {
        nodeIds.push(child.id)
      }
    }

    return {
      id: group.id,
      label: group.label,
      nodeIds,
      children,
    }
  }

  return groups
    .filter((group) => !group.parentId)
    .map(toMermaidSubgraph)
}

function detectArchitectureDirection(edges: ArchitectureEdge[]): Direction {
  let horizontal = 0
  let vertical = 0

  for (const edge of edges) {
    if (edge.source.side === 'L' || edge.source.side === 'R') horizontal++
    else vertical++

    if (edge.target.side === 'L' || edge.target.side === 'R') horizontal++
    else vertical++
  }

  return horizontal >= vertical ? 'LR' : 'TD'
}
