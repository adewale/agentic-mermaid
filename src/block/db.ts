import { parserObservationActive, observeParserMutation } from '../shared/parser-observation.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
// Adapted from Pele (458322a5b8abb1ae57ddf127c32017ab9fb14a92), copyright (c) 2026 kepano.
// MIT license; see pele-license.txt in this directory.
import type { Block, BlockClassDef, BlockModel, Statement } from './types.ts'
export interface BlockDbOptions {
  warn?: (message: string) => void
}
export function typeStr2Type(typeStr: string | undefined): string {
  switch (typeStr) {
    case '[]':
      return 'square'
    case '()':
      return 'round'
    case '(())':
      return 'circle'
    case '>]':
      return 'rect_left_inv_arrow'
    case '{}':
      return 'diamond'
    case '{{}}':
      return 'hexagon'
    case '([])':
      return 'stadium'
    case '[[]]':
      return 'subroutine'
    case '[()]':
      return 'cylinder'
    case '((()))':
      return 'doublecircle'
    case '[//]':
      return 'lean_right'
    case '[\\\\]':
      return 'lean_left'
    case '[/\\]':
      return 'trapezoid'
    case '[\\/]':
      return 'inv_trapezoid'
    case '<[]>':
      return 'block_arrow'
    default:
      return 'na'
  }
}
export function edgeStrToEdgeData(typeStr: string): string {
  switch (typeStr.trim().slice(-1)) {
    case 'x':
      return 'arrow_cross'
    case 'o':
      return 'arrow_circle'
    case '>':
      return 'arrow_point'
    default:
      return ''
  }
}
export function edgeStrToEdgeStartData(typeStr: string): string {
  switch (typeStr.trim().charAt(0)) {
    case 'x':
      return 'arrow_cross'
    case 'o':
      return 'arrow_circle'
    case '<':
      return 'arrow_point'
    default:
      return 'arrow_open'
  }
}
export function edgeStrToThickness(typeStr: string): string {
  return typeStr.includes('==') ? 'thick' : 'normal'
}
export function edgeStrToPattern(typeStr: string): string {
  return typeStr.includes('.-') ? 'dotted' : 'solid'
}
interface Frame {
  list: Block[]
  at: number
  parent: Block
  children: Block[]
  columns: number
}
function frame(statements: Statement[], parent: Block): Frame {
  const list = statements.flat()
  let columns = -1
  for (const block of list) {
    if (block.type === 'column-setting') {
      columns = block.columns ?? -1
      break
    }
  }
  return { list, at: 0, parent, children: [], columns }
}
export class BlockDb implements BlockModel {
  type = 'block' as const
  title: string | undefined
  root: Block = { id: 'root', type: 'composite', children: [], columns: -1 }
  blocks: Block[] = []
  edges: Block[] = []
  classes = new Map<string, BlockClassDef>()
  // Mermaid keeps the root in here too, which makes a block called `root` vanish. Here it stays out.
  byId = new Map<string, Block>()
  typeStr2Type = typeStr2Type
  edgeStrToEdgeData = edgeStrToEdgeData
  edgeStrToEdgeStartData = edgeStrToEdgeStartData
  edgeStrToThickness = edgeStrToThickness
  edgeStrToPattern = edgeStrToPattern
  private warn: ((message: string) => void) | undefined
  // Ids that a class or style statement named before any block had them.
  private pending = new Set<string>()
  private workIds = new Set<string>()

  private admitNode(id: string): void {
    if (this.workIds.has(id)) return
    assertDiagramWorkLimit('nodes', this.workIds.size + 1)
    this.workIds.add(id)
  }
  private edgeCount = new Map<string, number>()
  private ids = 0
  private colors = 0
  reservedIds = new Set<string>()
  constructor(options: BlockDbOptions = {}) {
    this.warn = options.warn
  }
  // Mermaid's ids are random. These are counted, so the same text always gives the same output.
  generateId(): string {
    let value: string
    do value = 'block_generated_' + ++this.ids
    while (this.reservedIds.has(value) || this.byId.has(value))
    this.reservedIds.add(value)
    if (parserObservationActive('block')) observeParserMutation('block', 'generate-id', value)
    return value
  }
  addStyleClass(id: string, styleAttributes = ''): void {
    let found = this.classes.get(id)
    if (!found) {
      found = { id, styles: [], textStyles: [] }
      this.classes.set(id, found)
    }
    for (const attribute of styleAttributes.split(',')) {
      const semi = attribute.indexOf(';')
      const fixed = (semi === -1 ? attribute : attribute.slice(0, semi) + attribute.slice(semi + 1)).trim()
      if (attribute.includes('color')) found.textStyles.push(fixed.replace('fill', 'bgFill').replace('color', 'fill'))
      found.styles.push(fixed)
      if (parserObservationActive('block')) observeParserMutation('block', 'define-class', { id, attribute: fixed })
    }
  }
  addStyle2Node(id: string, styles = ''): void {
    this.named(id).styles = styles.replace(/;\s*$/, '').split(',')
    if (parserObservationActive('block')) observeParserMutation('block', 'set-node-style', { id, styles: this.named(id).styles })
  }
  // Mermaid looks each id up before trimming it, so `class a, b hot` misses b. Here it is trimmed first.
  setCssClass(itemIds: string, cssClassName: string): void {
    for (const id of itemIds.split(',')) {
      ;(this.named(id.trim()).classes ??= []).push(cssClassName)
      if (parserObservationActive('block')) observeParserMutation('block', 'add-node-class', { id: id.trim(), className: cssClassName })
    }
  }
  // Mermaid throws on a style for an unknown id, and a class for one makes the block of that id
  // disappear when it is declared later. Here both wait for the block.
  private named(id: string): Block {
    let block = this.byId.get(id)
    if (block === undefined) {
      this.admitNode(id)
      block = { id, type: 'na', children: [] }
      this.byId.set(id, block)
      this.pending.add(id)
    }
    return block
  }
  unresolvedStyleTargets(): string[] {
    return [...this.pending]
  }
  setHierarchy(statements: Statement[]): void {
    const stack = [frame(statements, this.root)]
    while (stack.length > 0) {
      const f = stack[stack.length - 1]!
      if (f.at === f.list.length) {
        f.parent.children = f.children
        if (parserObservationActive('block')) observeParserMutation('block', 'set-children', { id: f.parent.id, children: f.children.map(n => n.id) })
        stack.pop()
        continue
      }
      const block = f.list[f.at++]!
      if (f.columns > 0 && block.type !== 'column-setting' && typeof block.widthInColumns === 'number' && block.widthInColumns > f.columns) {
        this.warn?.(`Block ${block.id} width ${block.widthInColumns} exceeds configured column width ${f.columns}`)
      }
      switch (block.type) {
        case 'classDef':
          this.addStyleClass(block.id, block.css)
          continue
        case 'applyClass':
          this.setCssClass(block.id, block.styleClass ?? '')
          continue
        case 'applyStyles':
          if (block.stylesStr) this.addStyle2Node(block.id, block.stylesStr)
          continue
        case 'column-setting':
          f.parent.columns = block.columns ?? -1
          if (parserObservationActive('block')) observeParserMutation('block', 'set-columns', { id: f.parent.id, columns: f.parent.columns })
          continue
        case 'edge': {
          assertDiagramWorkLimit('edges', this.edges.length + 1)
          const count = (this.edgeCount.get(block.id) ?? 0) + 1
          this.edgeCount.set(block.id, count)
          block.id = count + '-' + block.id
          this.edges.push(block)
          if (parserObservationActive('block')) observeParserMutation('block', 'add-edge', block)
          continue
        }
      }
      // A composite whose header was a link statement has no id of its own.
      block.id ??= this.generateId()
      if (block.type !== 'space') this.admitNode(block.id)
      if (!block.label) block.label = block.type === 'composite' ? '' : block.id
      const known = this.byId.get(block.id)
      const fresh = known === undefined || this.pending.delete(block.id)
      if (!fresh) {
        if (block.type !== 'na') known.type = block.type
        if (block.label !== block.id) known.label = block.label
      } else {
        if (known) {
          block.classes = known.classes
          block.styles = known.styles
        }
        if (block.type === 'composite') block.colorIndex = this.colors++
        this.byId.set(block.id, block)
      }
      if (parserObservationActive('block')) observeParserMutation('block', 'upsert-block', { parentId: f.parent.id, block: this.byId.get(block.id) })
      const inner = block.children
      block.children = []
      if (block.type === 'space') {
        const width = block.width ?? 1
        assertDiagramWorkLimit('nodes', this.workIds.size + Math.max(width, 0))
        for (let j = 0; j < width; j++) {
          const copy = { ...block, id: block.id + '-' + j, width: 1, children: [] }
          this.admitNode(copy.id)
          this.byId.set(copy.id, copy)
          f.children.push(copy)
          if (parserObservationActive('block')) observeParserMutation('block', 'attach-space', { parentId: f.parent.id, block: copy })
        }
      } else if (fresh) {
        f.children.push(block)
        if (parserObservationActive('block')) observeParserMutation('block', 'attach-child', { parentId: f.parent.id, block })
      }
      if (inner && inner.length > 0) stack.push(frame(inner, block))
    }
    this.blocks = this.root.children ?? []
    if (parserObservationActive('block')) observeParserMutation('block', 'complete-hierarchy', { root: this.root, edges: this.edges, classes: this.classes })
  }
}
