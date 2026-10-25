import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describeMermaidFacts, parseRegisteredMermaid, verifyMermaid } from '../../src/agent/index.ts'
import type { ParsedDiagram, RenderedLayout, VerifyResult } from '../../src/agent/types.ts'
import data from '../artifact-expectations.json'
import { classRelationshipMeaning, stateFailureProblems } from './domain-meaning.ts'

interface Expectation {
  family: string
  directory: string
  requiredFacts: string[]
  preserveExcept: string[]
  forbiddenFacts: string[]
}
const expectations: Record<string, Expectation> = data.cases

function parse(source: string, family: string): ParsedDiagram {
  if (!source.trim()) throw new Error('source artifact is empty')
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(`source does not parse: ${parsed.error.map(error => error.message).join('; ')}`)
  if (parsed.value.kind !== family || parsed.value.body.kind !== family) throw new Error(`expected structured ${family}, got ${parsed.value.kind}/${parsed.value.body.kind}`)
  return parsed.value
}

/** Public semantic layout fields bind submitted verification to this saved
 * source. Public deterministic placement also detects a stale verification
 * after a coordinate-only edit; debug/timing/private evidence is excluded. */
function layoutMeaning(layout: RenderedLayout) {
  return {
    kind: layout.kind,
    nodes: layout.nodes.map(node => [node.id, node.label, node.x, node.y, node.w, node.h]),
    edges: layout.edges.map(edge => [edge.from, edge.to, edge.label ?? null]),
    groups: layout.groups.map(group => [group.id, group.label, group.parentId ?? null, group.members]),
  }
}
function verificationMeaning(verification: VerifyResult) {
  if (typeof verification.ok !== 'boolean' || !Array.isArray(verification.warnings)) throw new Error('verify.json must contain boolean ok and warnings[]')
  const codes = verification.warnings
    .map(warning => {
      if (typeof warning?.code !== 'string') throw new Error('every reported warning needs a code')
      return warning.code
    })
    .sort()
  return { ok: verification.ok, warningCodes: codes, layout: layoutMeaning(verification.layout) }
}

/** Native records below own relationship orientation/multiplicity and Pie
 * insertion order; lexical fact indexes must not impose a second contract. */
function semanticFacts(diagram: ParsedDiagram): string[] {
  return describeMermaidFacts(diagram).filter(fact => {
    if (diagram.body.kind === 'class') return !/^relation(?:#\d+)? /.test(fact)
    if (['flowchart', 'er', 'architecture', 'requirement', 'block'].includes(diagram.body.kind)) return !/^(?:edge|relation)#\d+ /.test(fact)
    if (diagram.body.kind === 'c4') return !/^interaction#/.test(fact)
    if (diagram.body.kind === 'sankey') return !/^link#/.test(fact)
    if (diagram.body.kind === 'quadrant') return !/^point#/.test(fact)
    if (diagram.body.kind === 'pie') return !/^slice#/.test(fact)
    return true
  })
}

function preservedFacts(original: ParsedDiagram, expectation: Expectation): string[] {
  const exclusions = expectation.preserveExcept.map(pattern => new RegExp(pattern))
  return semanticFacts(original).filter(fact => !exclusions.some(pattern => pattern.test(fact)))
}

function fields(value: object, keys: readonly string[]): unknown[] {
  const record = value as Record<string, unknown>
  return keys.map(key => record[key] ?? null)
}

function checkDomainEdit(actual: ParsedDiagram, original: ParsedDiagram): string[] {
  const body = actual.body,
    before = original.body
  const problems: string[] = []
  const compare = (name: string, actual: unknown[], expected: unknown[], ordered = false) => {
    const encode = (rows: unknown[]) => {
      const values = rows.map(row => JSON.stringify(row, (_key, value) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value)))
      return JSON.stringify(ordered ? values : values.sort())
    }
    if (encode(actual) !== encode(expected)) problems.push(`${name} differ from the requested edit`)
  }
  const count = (name: string, actual: number, expected: number) => {
    if (actual !== expected) problems.push(`${name}: expected ${expected}, got ${actual}`)
  }
  if (body.kind === 'flowchart' && before.kind === 'flowchart') {
    count('flowchart nodes', body.graph.nodes.size, before.graph.nodes.size + 1)
    count('flowchart groups', body.graph.subgraphs.length, before.graph.subgraphs.length)
    const edge = (value: (typeof body.graph.edges)[number]) => fields(value, ['source', 'target', 'label', 'style', 'hasArrowStart', 'hasArrowEnd'])
    const replaced = before.graph.edges.find(edge => edge.source === 'API' && edge.target === 'DB')!
    compare('flowchart relationships', body.graph.edges.map(edge), [...before.graph.edges.filter(value => value !== replaced), { ...replaced, target: 'Cache' }, { ...replaced, source: 'Cache' }].map(edge))
  } else if (body.kind === 'sequence' && before.kind === 'sequence') {
    const message = (value: (typeof body.messages)[number]) => fields(value, ['from', 'to', 'text', 'style', 'arrow', 'wrap', 'centralStart', 'centralEnd', 'activate', 'deactivate'])
    const expected = [...before.messages]
    expected.splice(3, 0, { from: 'API', to: 'DB', text: 'Retry', style: 'sync', arrow: '->>' })
    compare('ordered sequence messages and arrows', body.messages.map(message), expected.map(message), true)
    compare(
      'ordered sequence participants',
      body.participants.map(value => fields(value, ['id', 'label', 'kind', 'wrap'])),
      before.participants.map(value => fields(value, ['id', 'label', 'kind', 'wrap'])),
      true,
    )
    if (body.statements.some(statement => statement.kind !== 'participant' && statement.kind !== 'message' && !(statement.kind === 'opaque-block' && statement.lines.every(line => !line.trim() || line.trimStart().startsWith('%%'))))) problems.push('sequence must retain the original top-level message scope')
  } else if (body.kind === 'c4' && before.kind === 'c4') {
    const audit = body.elements.find(element => element.id === 'audit')
    if (!audit || audit.kind !== 'system' || !audit.external || audit.label !== 'Audit service') problems.push('audit must be the requested external System')
    compare(
      'C4 element identities',
      body.elements.map(element => element.id),
      [...before.elements.map(element => (element.id === 'payments' ? 'provider' : element.id)), 'audit'],
    )
    const element = (value: (typeof body.elements)[number]) => fields(value, ['id', 'kind', 'external', 'shape', 'label', 'parentId', 'technology', 'description', 'tags', 'link', 'effectiveLink', 'sprite', 'style'])
    compare(
      'preserved C4 elements',
      body.elements.filter(element => element.id !== 'audit').map(element),
      before.elements.map(value => element({ ...value, id: value.id === 'payments' ? 'provider' : value.id })),
    )
    count('C4 boundaries', body.boundaries.length, before.boundaries.length)
    const relation = (value: (typeof body.relationships)[number]) => fields(value, ['from', 'to', 'source', 'target', 'label', 'technology', 'description', 'index', 'bidirectional', 'reversed', 'direction', 'tags', 'link', 'effectiveLink', 'sprite', 'style'])
    const renamed = before.relationships.map(value => ({ ...value, to: value.to === 'payments' ? 'provider' : value.to, target: value.target === 'payments' ? 'provider' : value.target }))
    const added = body.relationships.filter(value => value.from === 'shop' && value.to === 'audit' && value.label === 'Records purchase')
    // Technology on the new interaction is optional; original HTTPS survives.
    count('new Shop-to-Audit interaction', added.length, 1)
    compare('preserved C4 interactions', body.relationships.filter(value => !added.includes(value)).map(relation), renamed.map(relation))
    if (added.some(value => value.source !== 'shop' || value.target !== 'audit' || value.bidirectional || value.reversed)) problems.push('Records purchase must point from Shop to Audit')
  } else if (body.kind === 'class' && before.kind === 'class') {
    count('classes', body.classes.length, before.classes.length + 1)
    count('class notes', body.notes.length, before.notes.length)
    count('class namespaces', body.namespaces?.length ?? 0, before.namespaces?.length ?? 0)
    compare('class relationships', body.relations.map(classRelationshipMeaning), [...before.relations, { from: 'PaymentService', to: 'Receipt', kind: 'association' as const }].map(classRelationshipMeaning))
    for (const original of before.classes) count(`members of ${original.id}`, body.classes.find(value => value.id === original.id)?.members.length ?? -1, original.members.length)
  } else if (body.kind === 'er' && before.kind === 'er') {
    count('ER entities', body.entities.length, before.entities.length + 1)
    count('ER groups', body.groups?.length ?? 0, before.groups?.length ?? 0)
    const relation = (value: (typeof body.relations)[number]) => fields(value, ['from', 'to', 'leftCard', 'rightCard', 'dashed', 'label'])
    compare('ER relationships', body.relations.map(relation), [...before.relations, { from: 'ORDER', to: 'PRODUCT', leftCard: 'one-only' as const, rightCard: 'zero-or-many' as const, dashed: false, label: 'contains' }].map(relation))
    for (const original of before.entities) count(`attributes of ${original.id}`, body.entities.find(value => value.id === original.id)?.attributes.length ?? -1, original.attributes.length)
  } else if (body.kind === 'architecture' && before.kind === 'architecture') {
    count('architecture services', body.services.length, before.services.length + 1)
    count('architecture groups', body.groups.length, before.groups.length)
    count('architecture junctions', body.junctions.length, before.junctions.length)
    const edge = (value: (typeof body.edges)[number]) => [value.source.id, value.source.side, value.source.boundary ?? 'item', value.target.id, value.target.side, value.target.boundary ?? 'item', value.label ?? null, value.hasArrowStart, value.hasArrowEnd]
    compare(
      'architecture connections',
      body.edges.map(edge),
      [
        ...before.edges.filter(value => value.source.id !== 'api' || value.target.id !== 'db'),
        { source: { id: 'api', side: 'R' as const }, target: { id: 'Cache', side: 'L' as const }, hasArrowStart: false, hasArrowEnd: false },
        { source: { id: 'Cache', side: 'R' as const }, target: { id: 'db', side: 'L' as const }, hasArrowStart: false, hasArrowEnd: false },
      ].map(edge),
    )
  } else if (body.kind === 'state' && before.kind === 'state') {
    problems.push(...stateFailureProblems(before, body, { from: 'Processing', id: 'Failed', label: 'error' }))
  } else if (body.kind === 'kanban' && before.kind === 'kanban') {
    const parser = before.columns.flatMap(column => column.tasks).find(task => task.sourceId === 'parser')!
    const expected = before.columns.map(column => ({ ...column, tasks: column.sourceId === 'done' ? [...column.tasks, parser] : column.tasks.filter(task => task !== parser) }))
    const column = (value: (typeof body.columns)[number]) => [value.sourceId, value.label, value.metadata, value.tasks.map(task => fields(task, ['sourceId', 'label', 'metadata', 'icon', 'className']))]
    compare('ordered kanban columns and tasks', body.columns.map(column), expected.map(column), true)
  } else if (body.kind === 'requirement' && before.kind === 'requirement') {
    const requirement = (value: (typeof body.requirements)[number]) => fields(value, ['name', 'type', 'requirementId', 'text', 'risk', 'verifyMethod'])
    compare(
      'requirement fields',
      body.requirements.map(requirement),
      before.requirements.map(value => requirement({ ...value, verifyMethod: value.name === 'reliable' ? 'Analysis' : value.verifyMethod })),
    )
    const element = (value: (typeof body.elements)[number]) => fields(value, ['name', 'type', 'docRef'])
    compare(
      'requirement element identities',
      body.elements.map(element),
      before.elements.map(value => element({ ...value, name: value.name === 'suite' ? 'evidence' : value.name })),
    )
    const relation = (value: (typeof body.relations)[number]) => fields(value, ['src', 'dst', 'type'])
    compare(
      'requirement relationships',
      body.relations.map(relation),
      before.relations.map(value => relation({ ...value, src: value.src === 'suite' ? 'evidence' : value.src, dst: value.dst === 'suite' ? 'evidence' : value.dst })),
    )
  } else if (body.kind === 'block' && before.kind === 'block') {
    const tree = (value: typeof body.root, rename = false): unknown[] => [rename && value.id === 'primary' ? 'writer' : value.id, value.label ?? '', value.type === 'na' ? 'square' : value.type, value.columns ?? -1, value.widthInColumns ?? 1, value.width ?? null, (value.children ?? []).map(child => tree(child, rename))]
    compare('ordered block cells and membership', tree(body.root), tree(before.root, true), true)
    const edge = (value: (typeof body.edges)[number], rename = false) => [rename && value.start === 'primary' ? 'writer' : value.start, rename && value.end === 'primary' ? 'writer' : value.end, value.label ?? '', value.arrowTypeStart, value.arrowTypeEnd, value.thickness, value.pattern]
    compare(
      'block connections',
      body.edges.map(value => edge(value)),
      before.edges.map(value => edge(value, true)),
    )
  } else if (body.kind === 'sankey' && before.kind === 'sankey') {
    const link = (value: (typeof body.links)[number]) => fields(value, ['source', 'target', 'value'])
    compare('Sankey flows', body.links.map(link), [...before.links.map(value => ({ ...value, source: value.source === 'Electricity' ? 'Grid' : value.source, target: value.target === 'Electricity' ? 'Grid' : value.target })), { source: 'Grid', target: 'Losses', value: 56.69 }].map(link))
  } else if (body.kind === 'quadrant' && before.kind === 'quadrant') {
    const point = (value: (typeof body.points)[number]) => fields(value, ['label', 'x', 'y'])
    compare(
      'quadrant points',
      body.points.map(point),
      before.points.map(value => point(value.label === 'MCP setup' ? { ...value, x: 0.7, y: 0.4 } : value)),
    )
  } else if (body.kind === 'mindmap' && before.kind === 'mindmap') {
    const nodes = (node: typeof body.root): number => 1 + node.children.reduce((sum, child) => sum + nodes(child), 0)
    count('mindmap nodes', nodes(body.root), nodes(before.root) + 1)
  } else if (body.kind === 'gitgraph' && before.kind === 'gitgraph') {
    count('GitGraph branches', body.branches.length, before.branches.length + 1)
    count('GitGraph commits', body.commits.length, before.commits.length + 2)
    const selected = body.statements.filter(statement => statement.kind === 'branch' || statement.kind === 'checkout').at(-1)
    if (selected?.kind !== 'checkout' || selected.branch !== 'main') problems.push('GitGraph must return to main')
  } else if (body.kind === 'treemap' && before.kind === 'treemap') {
    count('treemap nodes', body.nodes.length, before.nodes.length)
    const design = body.nodes.find(node => node.label === 'Design')
    const parent = body.nodes.find(node => node.id === design?.parentId)
    if (!design || design.value !== 50 || parent?.label !== 'Build') problems.push('Design must remain under Build with value 50')
  } else if (body.kind === 'ishikawa' && before.kind === 'ishikawa') {
    count('Ishikawa nodes', body.nodes.length, before.nodes.length + 1)
    const cause = body.nodes.find(node => node.label === 'Cold caches')
    const parent = body.nodes.find(node => node.id === cause?.parentId)
    if (!cause || parent?.label !== 'Tooling') problems.push('Cold caches must be a cause under Tooling')
  } else if (body.kind === 'packet' && before.kind === 'packet') {
    count('packet fields', body.fields.length, before.fields.length + 1)
  } else if (body.kind === 'timeline' && before.kind === 'timeline') {
    count('timeline sections', body.sections.length, before.sections.length)
    count('timeline periods', body.sections.flatMap(section => section.periods).length, before.sections.flatMap(section => section.periods).length + 1)
    count('timeline events', body.sections.flatMap(section => section.periods.flatMap(period => period.events)).length, before.sections.flatMap(section => section.periods.flatMap(period => period.events)).length + 1)
  } else if (body.kind === 'journey' && before.kind === 'journey') {
    count('journey sections', body.sections.length, before.sections.length)
    count('journey tasks', body.sections.flatMap(section => section.tasks).length, before.sections.flatMap(section => section.tasks).length + 1)
  } else if (body.kind === 'gantt' && before.kind === 'gantt') {
    count('Gantt sections', body.sections.length, before.sections.length)
    count('Gantt tasks', body.sections.flatMap(section => section.tasks).length, before.sections.flatMap(section => section.tasks).length + 1)
  } else if (body.kind === 'xychart' && before.kind === 'xychart') {
    count('XY series', body.series.length, before.series.length)
  } else if (body.kind === 'radar' && before.kind === 'radar') {
    count('radar axes', body.axes.length, before.axes.length + 1)
    count('radar curves', body.curves.length, before.curves.length + 1)
  } else if (body.kind === 'pie' && before.kind === 'pie') {
    const added = body.slices.filter(slice => slice.label === 'PDF')
    count('PDF slices', added.length, 1)
    if (added.some(slice => slice.value !== 10)) problems.push('PDF must have value 10')
    const slice = (value: (typeof body.slices)[number]) => [value.label, value.value]
    compare('ordered original pie slices', body.slices.filter(slice => slice.label !== 'PDF').map(slice), before.slices.map(slice), true)
  }
  return problems
}

/** Grade artifacts, never the model's claim that it ran a particular process. */
export function gradeDiagramArtifact(outputDir: string, caseId: string): { ok: boolean; problems: string[] } {
  try {
    const expectation = expectations[caseId]
    if (!expectation) throw new Error(`unknown artifact case ${caseId}`)
    const originalSource = readFileSync(join(import.meta.dir, '..', 'fixtures', expectation.directory, 'input.mmd'), 'utf8')
    const finalSource = readFileSync(resolve(outputDir, 'outputs', expectation.directory, 'final.mmd'), 'utf8')
    const reported = JSON.parse(readFileSync(resolve(outputDir, 'outputs', expectation.directory, 'verify.json'), 'utf8')) as VerifyResult
    const original = parse(originalSource, expectation.family)
    const actual = parse(finalSource, expectation.family)
    const have = new Set(semanticFacts(actual))
    const missing = [...preservedFacts(original, expectation), ...expectation.requiredFacts].filter(fact => !have.has(fact))
    const forbidden = expectation.forbiddenFacts.filter(fact => have.has(fact))
    const problems = [...missing.map(fact => `missing fact: ${fact}`), ...forbidden.map(fact => `forbidden fact: ${fact}`), ...checkDomainEdit(actual, original)]
    if (JSON.stringify(describeMermaidFacts(actual)) === JSON.stringify(describeMermaidFacts(original))) problems.push('saved diagram is semantically unchanged')
    const fresh = verifyMermaid(finalSource)
    if (!fresh.ok) problems.push('saved diagram fails fresh verification')
    if (JSON.stringify(verificationMeaning(reported)) !== JSON.stringify(verificationMeaning(fresh))) problems.push('submitted verification decisions, warning codes or semantic layout do not match saved source')
    return { ok: problems.length === 0, problems }
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)] }
  }
}

if (import.meta.main) {
  // Grading SDK calls are evaluator work, outside the observed agent run.
  delete process.env.AM_TRACE_LOG
  const [outputDir, caseId] = process.argv.slice(2)
  const result = outputDir && caseId ? gradeDiagramArtifact(outputDir, caseId) : { ok: false, problems: ['usage: diagram-artifact.ts OUTPUT_DIR CASE_ID'] }
  console.log(JSON.stringify({ score: result.ok ? 1 : 0, max_score: 1, problems: result.problems }))
  if (!result.ok) process.exitCode = 1
}
