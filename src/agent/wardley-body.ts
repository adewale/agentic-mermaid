import { ownExistingBodyTitle } from './body-title-meta.ts'
import { withParserObservation } from '../shared/parser-observation.ts'
import { mapObservedSource } from './source-map-spans.ts'
import { ownBodyAccessibility } from './accessibility-envelope.ts'
import { unknownOpMessage } from './mutation-ops.ts'
import { parseWardleyBody } from '../wardley/body.ts'
import type { WardleyBody, WardleyMutationOp } from '../wardley/types.ts'
import { mermaidNumber } from '../shared/mermaid-number.ts'
import { sameSourceMeaning } from './source-mutation.ts'
import { nativeAccessibilityText } from './accessibility-envelope.ts'
import { accessibilityFields } from '../shared/accessibility-directives.ts'
import { readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import type { FamilyOperations } from './families.ts'
import { err, ok, type LayoutWarning, type MutationError, type Result } from './types.ts'
export { WARDLEY_OP_SCHEMAS, WARDLEY_OP_KINDS } from '../wardley/ops.ts'

export { parseWardleyBody } from '../wardley/body.ts'


const quoted = (value: string): string => JSON.stringify(value).replace(/%%\{/g, '\\%\\%{')
function decimal(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('Wardley numbers must be finite and nonnegative')
  const text = mermaidNumber(value)
  return text.includes('.') ? text : text + '.0'
}
function percent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 100) throw new Error('Wardley coordinates must be finite percentages in 0..100')
  return decimal(value <= 1 ? value / 100 : value)
}
function offset(node: WardleyBody['nodes'][number]): string {
  if (node.labelOffsetX === undefined && node.labelOffsetY === undefined) return ''
  const x = node.labelOffsetX ?? 0, y = node.labelOffsetY ?? 0
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Wardley label offsets must be integers')
  return ` label [${x}, ${y}]`
}
export function renderWardley(body: WardleyBody): string {
  const lines = ['wardley-beta']
  if (body.title !== undefined) {
    if (/[\r\n]/.test(body.title) || !body.title.trim() || body.title.includes('%%{')) throw new Error('Wardley title must be nonempty single-line text without directive openers')
    lines.push(`title ${body.title}`)
  }
  if (body.accessibilityTitle !== undefined) lines.push(`accTitle: ${nativeAccessibilityText(body.accessibilityTitle).replace(/\n/g, ' ')}`)
  if (body.accessibilityDescription !== undefined) {
    const text = nativeAccessibilityText(body.accessibilityDescription)
    if (text.includes('}')) throw new Error('Wardley accessibility description cannot contain a closing block delimiter')
    lines.push(text.includes('\n') ? `accDescr {\n${text}\n}` : `accDescr: ${text}`)
  }
  if (body.size) {
    if (![body.size.width, body.size.height].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Wardley size must contain positive safe integers')
    lines.push(`size [${body.size.width}, ${body.size.height}]`)
  }
  if (body.axes.stages?.length) {
    if (body.axes.stages.length < 2) throw new Error('Wardley evolution requires at least two stages')
    lines.push(`evolution ${body.axes.stages.map((stage, index) => quoted(stage) + (body.axes.stageBoundaries?.[index] !== undefined ? `@${decimal(body.axes.stageBoundaries[index]!)}` : '')).join(' -> ')}`)
  }
  const ids = new Set<string>(), nodes = new Map(body.nodes.map(node => [node.id, node]))
  const pipelineIds = new Set(body.pipelines.flatMap(pipeline => pipeline.componentIds))
  for (const node of body.nodes) {
    if (ids.has(node.id) || !node.id.length) throw new Error('Wardley components require unique nonempty identities')
    ids.add(node.id)
    if (pipelineIds.has(node.id)) continue
    if (node.id !== node.label) throw new Error('Wardley standalone component labels are their source identities')
    const keyword = node.className === 'anchor' ? 'anchor' : 'component'
    if (keyword === 'anchor' && (node.inertia || node.sourceStrategy || node.labelOffsetX !== undefined || node.labelOffsetY !== undefined)) throw new Error('Wardley anchors cannot carry component decorators')
    lines.push(`${keyword} ${quoted(node.id)} [${percent(node.y)}, ${percent(node.x)}]${keyword === 'component' ? offset(node) + (node.sourceStrategy ? ` (${node.sourceStrategy})` : '') + (node.inertia ? ' inertia' : '') : ''}`)
  }
  for (const pipeline of body.pipelines) {
    if (!nodes.has(pipeline.nodeId) || !pipeline.componentIds.length) throw new Error('Wardley pipelines require a parent and at least one component')
    lines.push(`pipeline ${quoted(pipeline.nodeId)} {`)
    for (const id of pipeline.componentIds) {
      const node = nodes.get(id)
      if (!node || id !== `${pipeline.nodeId}_${node.label}` || node.y !== nodes.get(pipeline.nodeId)!.y) throw new Error('Wardley pipeline identities and visibility must agree with their parent')
      lines.push(`  component ${quoted(node.label)} [${percent(node.x)}]${offset(node)}`)
    }
    lines.push('}')
  }
  for (const link of body.links) {
    if (!nodes.has(link.source) || !nodes.has(link.target)) throw new Error('Wardley dependency endpoints must name existing components')
    if (link.label !== undefined && (/[\r\n]/.test(link.label) || link.label.includes('%%{'))) throw new Error('Wardley dependency labels must be single-line text without directive openers')
    const port = link.flow === 'bidirectional' ? '+<>' : link.flow === 'backward' ? '+<' : link.flow === 'forward' ? '+>' : ''
    lines.push(`${quoted(link.source)} ${port} ${link.dashed ? '-.->' : '->'} ${quoted(link.target)}${link.label !== undefined ? ` ;${link.label}` : ''}`)
  }
  for (const trend of body.trends) {
    if (!nodes.has(trend.nodeId) || trend.targetY !== nodes.get(trend.nodeId)!.y) throw new Error('Wardley evolution preserves component visibility')
    lines.push(`evolve ${quoted(trend.nodeId)} ${percent(trend.targetX)}`)
  }
  for (const note of body.notes) lines.push(`note ${quoted(note.text)} [${percent(note.y)}, ${percent(note.x)}]`)
  if (body.annotationsBox) lines.push(`annotations [${percent(body.annotationsBox.y)}, ${percent(body.annotationsBox.x)}]`)
  for (const annotation of body.annotations) {
    if (!Number.isSafeInteger(annotation.number) || annotation.number < 0) throw new Error('Wardley annotation numbers must be nonnegative integers')
    for (const at of annotation.coordinates) lines.push(`annotation ${annotation.number}, [${percent(at.y)}, ${percent(at.x)}] ${quoted(annotation.text ?? '')}`)
  }
  for (const [keyword, forces] of [['accelerator', body.accelerators], ['deaccelerator', body.deaccelerators]] as const)
    for (const force of forces) lines.push(`${keyword} ${quoted(force.name)} [${percent(force.y)}, ${percent(force.x)}]`)
  return lines.join('\n') + '\n'
}

export function mutateWardley(body: WardleyBody, op: WardleyMutationOp): Result<WardleyBody, MutationError> {
  try {
    const next = structuredClone(body), nodes = new Map(next.nodes.map(node => [node.id, node]))
    const find = (id: string) => { const node = nodes.get(id); if (!node) throw new Error(`Wardley component ${id} was not found`); return node }
    switch (op.kind) {
      case 'set_title': next.title = op.title ?? undefined; break
      case 'set_accessibility_title': next.accessibilityTitle = op.title == null ? undefined : nativeAccessibilityText(op.title); break
      case 'set_accessibility_description': next.accessibilityDescription = op.description == null ? undefined : nativeAccessibilityText(op.description); break
      case 'add_component':
        if (nodes.has(op.id)) throw new Error(`Wardley component ${op.id} already exists`)
        next.nodes.push({ id: op.id, label: op.id, x: op.x, y: op.y, className: op.anchor ? 'anchor' : 'component', ...(op.anchor ? {} : { inertia: false }) })
        break
      case 'set_component_position': {
        const node = find(op.id)
        if (node.inPipeline && node.y !== op.y) throw new Error('A pipeline component shares visibility with its parent')
        node.x = op.x; node.y = op.y
        const children = new Set(next.pipelines.find(pipeline => pipeline.nodeId === op.id)?.componentIds ?? [])
        for (const child of children) find(child).y = op.y
        for (const trend of next.trends) if (trend.nodeId === op.id || children.has(trend.nodeId)) trend.targetY = op.y
        break
      }
      case 'remove_component': {
        find(op.id)
        const removed = new Set([op.id, ...(next.pipelines.find(pipeline => pipeline.nodeId === op.id)?.componentIds ?? [])])
        if (next.pipelines.some(pipeline => pipeline.componentIds.includes(op.id) && pipeline.componentIds.length === 1)) throw new Error('Removing the last pipeline component would leave an unspellable empty pipeline')
        next.nodes = next.nodes.filter(node => !removed.has(node.id))
        next.links = next.links.filter(link => !removed.has(link.source) && !removed.has(link.target))
        next.trends = next.trends.filter(trend => !removed.has(trend.nodeId))
        next.pipelines = next.pipelines.filter(pipeline => !removed.has(pipeline.nodeId)).map(pipeline => ({ ...pipeline, componentIds: pipeline.componentIds.filter(id => !removed.has(id)) }))
        break
      }
      case 'add_dependency': find(op.source); find(op.target); next.links.push({ source: op.source, target: op.target, label: op.label, dashed: op.dashed ?? false, flow: op.flow }); break
      case 'remove_dependency':
        if (!Number.isInteger(op.index) || !next.links[op.index]) throw new Error('Wardley dependency index was not found')
        next.links.splice(op.index, 1); break
      case 'set_evolution': {
        const node = find(op.id), trend = next.trends.find(trend => trend.nodeId === op.id)
        if (trend) trend.targetX = op.x
        else next.trends.push({ nodeId: op.id, targetX: op.x, targetY: node.y! })
        break
      }
      case 'add_note': next.notes.push({ text: op.text, x: op.x, y: op.y }); break
      default: return err({ code: 'INVALID_OP', message: unknownOpMessage('wardley', op) })
    }
    const actual = parseWardleyBody(renderWardley(next))
    if (!sameSourceMeaning(actual, next)) throw new Error('Wardley edit cannot retain the requested complete map semantics in Mermaid source')
    return ok(next)
  } catch (error) { return err({ code: 'INVALID_OP', message: error instanceof Error ? error.message : String(error) }) }
}

export function verifyWardley(body: WardleyBody): LayoutWarning[] {
  try { renderWardley(body); return [] } catch (error) { return [{ code: 'UNSUPPORTED_SYNTAX', syntax: 'wardley_model', message: String(error) }] }
}
export const WARDLEY_SOURCE_HOOKS: FamilyOperations = {
  bodyMeta: ownExistingBodyTitle('wardley'),
  bodyAccessibility: ownBodyAccessibility('wardley'),
  parse: ctx => {
    try {
      const body = parseWardleyBody(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
      const accessibility = readAuthoredGrammarAccessibility(ctx.meta.accessibility)
      Object.assign(body, accessibilityFields(accessibility)); ctx.meta.accessibility = accessibility
      if (body.title === undefined && typeof ctx.source.frontmatter.title === 'string') body.title = ctx.source.frontmatter.title
      if (!sameSourceMeaning(parseWardleyBody(renderWardley(body)), body)) throw new Error('Wardley source has no complete typed spelling')
      return ok(body)
    } catch { return ok({ kind: 'opaque', family: 'wardley', source: ctx.opaqueSource }) }
  },
  buildSourceMap: (body, source, context) => mapObservedSource(source, context, (text, record) => {
    if (body.kind !== 'wardley') return
    let link = 0, note = 0, annotation = 0, accelerator = 0, deaccelerator = 0
    const trends = new Map(body.trends.map((trend, index) => [trend.nodeId, index]))
    withParserObservation('wardley', event => {
      if (event.unit !== 'mutation' || event.source?.offset === undefined || event.source.endOffset === undefined) return
      const add = (kind: 'nodes' | 'edges' | 'groups' | 'labels', id: string) => record(kind, id, event.source!.offset!, event.source!.endOffset!)
      switch (event.kind) {
        case 'add-node': {
          const node = event.value as unknown as WardleyBody['nodes'][number]
          add('nodes', node.id); add('labels', `node:${node.id}`)
          if (node.sourceStrategy) add('labels', `strategy:${node.id}`)
          break
        }
        case 'add-link': {
          const value = event.value as unknown as WardleyBody['links'][number]
          add('edges', `dependency:${link}`)
          if (value.label !== undefined) add('labels', `dependency-label:${link}`)
          link++; break
        }
        case 'add-trend': {
          const value = event.value as unknown as WardleyBody['trends'][number], index = trends.get(value.nodeId)
          if (index !== undefined) add('edges', `evolve:${index}`)
          break
        }
        case 'start-pipeline': add('groups', `pipeline:${(event.value as unknown as WardleyBody['pipelines'][number]).nodeId}`); break
        case 'add-note': add('labels', `note:${note++}`); break
        case 'add-annotation': {
          const value = event.value as unknown as WardleyBody['annotations'][number]
          value.coordinates.forEach((_, index) => add('labels', `annotation:${annotation}:${index}`))
          if (value.text) add('labels', `annotation-text:${annotation}`)
          annotation++; break
        }
        case 'add-accelerator': add('labels', `accelerator:${accelerator++}`); break
        case 'add-deaccelerator': add('labels', `deaccelerator:${deaccelerator++}`); break
        case 'set-axes': (event.value as unknown as WardleyBody['axes']).stages?.forEach((_, index) => add('labels', `stage:${index}`)); break
        case 'set-title': add('labels', 'title'); break
      }
    }, () => parseWardleyBody(text), { mutations: ['add-node', 'add-link', 'add-trend', 'start-pipeline', 'add-note', 'add-annotation', 'add-accelerator', 'add-deaccelerator', 'set-axes', 'set-title'] })
  }),
  serialize: body => { if (body.kind !== 'wardley') throw new Error('Expected Wardley body'); return renderWardley(body) },
  renderSource: () => 'serialized',
  verify: body => body.kind === 'wardley' ? verifyWardley(body) : [],
  extractLabels: source => { try { const body = parseWardleyBody(source); return [...body.nodes.map(node => ({ text: node.label, target: node.id })), ...body.notes.map((note, index) => ({ text: note.text, target: `note:${index}` }))] } catch { return [] } },
}

export const WARDLEY_MUTATION_HOOKS: Pick<FamilyOperations, 'mutate'> = {
  mutate: (body, op) => body.kind === 'wardley' ? mutateWardley(body, op as WardleyMutationOp) : err({ code: 'INVALID_OP', message: 'Expected Wardley body' }),
}
