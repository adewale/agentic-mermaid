import { appendAccessibilityLines } from '../agent/accessibility-envelope.ts'
import { sameSourceMeaning } from '../agent/source-mutation.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { writeGrammarText } from '../shared/grammar-text.ts'
import { Arrow } from './grammar/types.ts'
import { parseUsecaseDiagram } from './parser.ts'
import type { UsecaseBody, UsecaseNode } from './types.ts'

const escaped = (text: string) => writeGrammarText(text, '"%').replace(/\r/g, '#13;').replace(/\n/g, '#10;')
const quoted = (value: string, labelType = 'text') => `"${labelType === 'markdown' ? '`' : ''}${escaped(value)}${labelType === 'markdown' ? '`' : ''}"`
const id = (value: string): string => {
  if (!/^\w+$/.test(value)) throw new Error(`UseCase identity ${value} cannot be exported as an identifier`)
  return value
}
const classes = (values: string[]) => (values.length ? `:::${values.map(id).join(',')}` : '')
const style = (values: string[]) => values.map(value => value.replace(/,/g, '\\,')).join(',')
const metadata = (properties: string[]) => (properties.length ? `@{ ${properties.join(', ')} }` : '')

function iconText(value: string): string {
  if (/[\r\n]/.test(value) || (value.includes('\"') && value.includes("'"))) throw new Error('UseCase icon names cannot be exported with line breaks or both quote delimiters')
  const delimiter = value.includes('\"') ? "'" : '\"'
  return `${delimiter}${value}${delimiter}`
}
function nodeLine(node: UsecaseNode): string {
  const shape = node.kind === 'actor' || node.shape === 'ellipse' ? ['(', ')'] : ['[', ']']
  const properties = node.kind === 'actor' ? [node.type !== 'normal' && node.type !== 'icon' ? `type: ${node.type}` : '', node.icon ? `icon: ${iconText(node.icon)}` : ''] : []
  if (node.business) properties.push('business: true')
  if (node.stereotype !== undefined && /[\r\n<>]/.test(node.stereotype)) throw new Error('UseCase stereotypes must be single-line text without angle brackets')
  return `${node.kind === 'actor' ? 'actor ' : ''}${id(node.id)}${shape[0]}${quoted(node.label, node.labelType)}${shape[1]}${metadata(properties.filter(Boolean))}${node.stereotype ? ` <<${node.stereotype}>>` : ''}${classes(node.classes)}`
}
function orderedJson(value: unknown, order: ReadonlyMap<string, string[]>, pointer = '', depth = 0): string {
  assertDiagramWorkLimit('nesting', depth)
  if (Array.isArray(value)) return `[${value.map((item, index) => orderedJson(item, order, `${pointer}/${index}`, depth + 1)).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>,
      preferred = order.get(pointer) ?? [],
      keys = [...preferred.filter(key => Object.hasOwn(object, key)), ...Object.keys(object).filter(key => !preferred.includes(key))]
    return `{${keys.map(key => `${JSON.stringify(key)}:${orderedJson(object[key], order, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth + 1)}`).join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('UseCase JSON nodes must contain JSON values')
  return encoded
}
export function serializeUsecase(body: UsecaseBody, includeTitleWrapper = true): string {
  const lines = ['usecase-beta', `direction ${body.direction}`]
  appendAccessibilityLines(lines, {
    ...(body.accessibilityTitle === undefined ? {} : { accessibilityTitle: writeGrammarText(body.accessibilityTitle, ':;,%{}') }),
    ...(body.accessibilityDescription === undefined ? {} : { accessibilityDescription: writeGrammarText(body.accessibilityDescription, ':;,%{}') }),
  })
  const boundaryLine = (boundary: UsecaseBody['boundaries'][number]) => `systemBoundary ${id(boundary.id)}[${quoted(boundary.label, boundary.labelType)}]${metadata(boundary.type !== 'rect' ? [`type: ${boundary.type}`] : [])}${classes(boundary.classes)}`
  // Declare boundary order independently of node order. Reopening a boundary
  // adds its members; each node still has exactly one authored parent.
  for (const boundary of body.boundaries) lines.push(boundaryLine(boundary), 'end')
  const boundaries = new Map(body.boundaries.map(boundary => [boundary.id, boundary]))
  let parent: string | undefined
  for (const node of body.nodes) {
    if (node.parentId !== parent) {
      if (parent) lines.push('end')
      parent = node.parentId
      if (parent) {
        const boundary = boundaries.get(parent)
        if (!boundary) throw new Error(`Unknown UseCase boundary ${parent}`)
        lines.push(boundaryLine(boundary))
      }
    }
    lines.push(`${parent ? '  ' : ''}${nodeLine(node)}`)
  }
  if (parent) lines.push('end')
  for (const node of body.jsonNodes) lines.push(`json ${id(node.id)}@${orderedJson(node.value, new Map(node.propertyOrder))}${classes(node.classes)}`)
  for (const edge of body.relationships) {
    const prefix = `${id(edge.source)} ${edge.explicitId ? `${id(edge.id)}@` : ''}`,
      target = id(edge.target)
    if (edge.type === 'include' || edge.type === 'extend') lines.push(`${prefix}..> : ${edge.type} ${target}`)
    else if (edge.type === 'generalization') lines.push(`${prefix}--|> ${target}`)
    else {
      if (!Number.isSafeInteger(edge.minlen) || edge.minlen < 1 || edge.minlen > 1000) throw new Error('Invalid UseCase relationship length')
      const dashes = '-'.repeat(edge.minlen + 1),
        label = edge.label === undefined ? undefined : quoted(edge.label, edge.labelType)
      const forward = edge.arrowType === Arrow.SOLID_ARROW ? `${dashes}>` : edge.arrowType === Arrow.CIRCLE_ARROW ? '--o' : edge.arrowType === Arrow.CROSS_ARROW ? '--x' : dashes
      const backward = edge.arrowType === Arrow.BACK_ARROW ? '<--' : edge.arrowType === Arrow.CIRCLE_ARROW_REVERSED ? 'o--' : edge.arrowType === Arrow.CROSS_ARROW_REVERSED ? 'x--' : undefined
      lines.push(`${prefix}${backward ? (label ? `${backward} ${label} ${dashes}` : backward === '<--' ? `<${dashes}` : backward) : label ? `-- ${label} ${forward}` : forward} ${target}`)
    }
  }
  for (const note of body.notes) lines.push(`note for ${id(note.target)} ${quoted(note.label, note.labelType)}`)
  for (const cls of body.classDefs) if (cls.styles.length) lines.push(`classDef ${id(cls.id)} ${style(cls.styles)}`)
  const styled = [...body.nodes, ...body.boundaries, ...body.jsonNodes, ...body.relationships]
  for (const item of styled) {
    if (item.styles.length) lines.push(`style ${id(item.id)} ${style(item.styles)}`)
    if ('source' in item && item.classes.length) lines.push(`class ${id(item.id)} ${item.classes.map(id).join(',')}`)
    if ('source' in item && (item.animate || item.animation)) lines.push(`${id(item.id)}${metadata([...(item.animation ? [`animation: ${item.animation}`] : []), `animate: ${item.animate}`])}`)
  }
  const written = lines.join('\n') + '\n'
  const reparsed = parseUsecaseDiagram(written)
  if (!sameSourceMeaning(usecaseMeaning(body), usecaseMeaning(reparsed))) throw new Error('UseCase export would change typed content')
  return includeTitleWrapper && body.title !== undefined ? `---\ntitle: ${JSON.stringify(body.title)}\n---\n${written}` : written
}

/** Generated edge ids are source-order handles; authored ids remain semantic. */
export function usecaseMeaning(body: UsecaseBody): unknown {
  return { ...body, title: undefined, relationships: body.relationships.map(edge => (edge.explicitId ? edge : { ...edge, id: undefined })) }
}
