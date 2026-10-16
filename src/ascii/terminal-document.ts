import type { RenderedRegionKind } from '../agent/types.ts'
import type { TerminalProjectionDiagnostic } from '../terminal-style.ts'
import { graphemes } from '../shared/graphemes.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { sanitizeTerminalText } from '../terminal-security.ts'
import { colorizeLine, colorizeText, DEFAULT_ASCII_THEME } from './ansi.ts'
import type { AsciiTheme, CharRole, ColorMode } from './types.ts'
import { charVisualWidth, visualWidth, WIDE_CHAR_CONTINUATION } from './width.ts'

export interface TerminalOwner {
  id: string
  kind?: Exclude<RenderedRegionKind, 'canvas'> | 'subgraph'
  sourceLine?: number
  parentId?: string
  members?: readonly string[]
  /** Shared runs may join only when their family layout declares a bundle. */
  bundle?: string
  from?: string
  to?: string
}

export interface TerminalBounds { x: number; y: number; width: number; height: number }
export interface TerminalPaint {
  owner?: TerminalOwner
  role?: CharRole | null
  color?: string
  kind?: 'text' | 'stroke' | 'marker' | 'surface'
  /** Explicit logical text occurrence, for interleaved wrapped table columns. */
  textGroup?: string
}
export interface TerminalRun extends TerminalPaint { text: string }
export interface TerminalSerializeOptions {
  colorMode?: ColorMode
  theme?: AsciiTheme
  trimEnd?: boolean
}
interface TextBlock extends TerminalBounds {}
export interface TerminalCell extends TerminalPaint {
  glyph: string
  owners: readonly TerminalOwner[]
  head: number
  width: number
  textBlock?: TextBlock
}
export interface TerminalCellSpan { row: number; start: number; end: number }
export interface TerminalPort { nodeId: string; x: number; y: number; side?: 'T' | 'B' | 'L' | 'R'; end: 'start' | 'end' }
export interface TerminalRegion {
  id: string
  kind: NonNullable<TerminalOwner['kind']>
  sourceLine?: number
  parentId?: string
  members?: readonly string[]
  from?: string
  to?: string
  bundle?: string
  ports?: TerminalPort[]
  canvasRow: number
  canvasColStart: number
  canvasColEnd: number
  rowSpan?: number
  projectedText?: string
  authoredTextCells?: Array<{ row: number; column: number; glyph: string }>
  ownedCellSpans: TerminalCellSpan[]
}
export interface TerminalCompositionDiagnostic {
  code: 'TERMINAL_TEXT_COLLISION' | 'TERMINAL_ROUTE_OVERLAP' | 'TERMINAL_GEOMETRY_COLLISION'
  feature: string
  message: string
}

const ownerKey = (owner: TerminalOwner): string => `${owner.kind ?? 'node'}\0${owner.id}`
const strokePorts: Readonly<Record<string, number>> = {
  '─': 10, '│': 5, '┌': 6, '┐': 12, '└': 3, '┘': 9,
  '├': 7, '┤': 13, '┬': 14, '┴': 11, '┼': 15,
  '╴': 8, '╵': 1, '╶': 2, '╷': 4,
}
const portGlyph = new Map(Object.entries(strokePorts).map(([glyph, ports]) => [ports, glyph]))
const styledPorts: Readonly<Record<string, number>> = { '┄': 10, '╌': 10, '┈': 10, '━': 10, '═': 10, '┆': 5, '┊': 5, '╎': 5, '┃': 5, '║': 5, '╔': 6, '╗': 12, '╚': 3, '╝': 9 }
const asciiPorts: Readonly<Record<string, number>> = { '-': 10, '=': 10, '.': 10, '|': 5, ':': 5, '+': 15 }
const flipXGlyph: Readonly<Record<string, string>> = {
  '>': '<', '<': '>', '►': '◄', '◄': '►', '▶': '◀', '◀': '▶',
  '┌': '┐', '┐': '┌', '└': '┘', '┘': '└', '├': '┤', '┤': '├',
  '╭': '╮', '╮': '╭', '╰': '╯', '╯': '╰', '╴': '╶', '╶': '╴',
  '╔': '╗', '╗': '╔', '╚': '╝', '╝': '╚', '◁': '▷', '▷': '◁',
}
const flipYGlyph: Readonly<Record<string, string>> = {
  '^': 'v', 'v': '^', '▲': '▼', '▼': '▲', '◤': '◣', '◣': '◤', '◥': '◢', '◢': '◥',
  '┌': '└', '└': '┌', '┐': '┘', '┘': '┐', '┬': '┴', '┴': '┬',
  '╭': '╰', '╰': '╭', '╮': '╯', '╯': '╮', '╵': '╷', '╷': '╵',
  '╔': '╚', '╚': '╔', '╗': '╝', '╝': '╗', '△': '▽', '▽': '△',
}

function integer(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative integer terminal coordinate`)
}
function union(a: TerminalBounds, b: TerminalBounds): TerminalBounds {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** Positioned terminal output. Only occupied cells are allocated; text owns spaces. */
export class TerminalDocument {
  width: number
  height: number
  /** A native title policy may deliberately suppress an otherwise valid title. */
  titleHandled = false
  readonly diagnostics: TerminalProjectionDiagnostic[] = []
  readonly metrics = { writes: 0, overlayVisits: 0, outputCells: 0 }
  private rows = new Map<number, Map<number, TerminalCell>>()
  private owners = new Map<string, TerminalOwner>()
  private declared = new Map<string, TerminalBounds>()
  private ports = new Map<string, TerminalPort[]>()
  private activeOwner: TerminalOwner | undefined
  private activeTextBlock: TextBlock | undefined
  private textGroups = new Map<string, TextBlock>()
  private diagnosticKeys = new Set<string>()
  private lineWidths: number[] | undefined
  private emittedWidths: number[] | undefined

  constructor(width = 0, height = 0) {
    integer(width, 'width'); integer(height, 'height')
    this.width = width; this.height = height
  }

  get occupiedCells(): number {
    let count = 0
    for (const row of this.rows.values()) count += row.size
    return count
  }

  resize(width: number, height: number): void {
    integer(width, 'width'); integer(height, 'height')
    this.width = Math.max(this.width, width); this.height = Math.max(this.height, height)
    this.emittedWidths = undefined
  }

  get(x: number, y: number): string { return this.rows.get(y)?.get(x)?.glyph ?? ' ' }
  cell(x: number, y: number): TerminalCell | undefined { return this.rows.get(y)?.get(x) }
  hasOwner(id: string, kind?: TerminalOwner['kind']): boolean { return [...this.owners.values()].some(owner => owner.id === id && (kind === undefined || owner.kind === kind)) }

  *entries(): IterableIterator<readonly [number, number, TerminalCell]> {
    for (const [y, row] of this.rows) for (const [x, cell] of row) yield [x, y, cell] as const
  }

  /** Attach identity at a family drawing boundary, retaining explicit text cells. */
  attribute(owners: TerminalOwner | readonly TerminalOwner[], paint: Omit<TerminalPaint, 'owner'> = {}): this {
    const attributed = (Array.isArray(owners) ? owners : [owners]).map(owner => this.remember(owner)!)
    for (const [, , cell] of this.entries()) {
      cell.owners = [...new Map([...cell.owners, ...attributed].map(owner => [ownerKey(owner), owner])).values()]
      cell.owner ??= attributed[0]
      if (cell.kind !== 'text') {
        if (paint.role !== undefined) cell.role = paint.role
        if (paint.kind !== undefined) cell.kind = paint.kind
      }
      if (paint.color !== undefined) cell.color = paint.color
    }
    return this
  }

  attributeWithin(owner: TerminalOwner, bounds: TerminalBounds, paint: Omit<TerminalPaint, 'owner'> = {}): this {
    for (const [label, value] of Object.entries({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })) integer(value, label)
    const attributed = this.remember(owner)!
    for (const [x, y, cell] of this.entries()) {
      if (x < bounds.x || x >= bounds.x + bounds.width || y < bounds.y || y >= bounds.y + bounds.height) continue
      if (!cell.owners.some(existing => ownerKey(existing) === ownerKey(attributed))) cell.owners = [...cell.owners, attributed]
      if (paint.role !== undefined && cell.kind !== 'text') cell.role = paint.role
      if (paint.color !== undefined) cell.color = paint.color
    }
    return this
  }

  private remember(owner: TerminalOwner | undefined): TerminalOwner | undefined {
    if (!owner) return undefined
    const key = ownerKey(owner), previous = this.owners.get(key)
    if (previous) return previous
    const frozen = Object.freeze({ ...owner, ...(owner.members ? { members: Object.freeze([...owner.members]) } : {}) })
    this.owners.set(key, frozen)
    return frozen
  }

  scope<T>(owner: TerminalOwner, draw: () => T): T {
    const previous = this.activeOwner
    const previousBlock = this.activeTextBlock
    this.activeOwner = this.remember(owner)
    this.activeTextBlock = undefined
    try { return draw() } finally { this.activeOwner = previous; this.activeTextBlock = previousBlock }
  }

  region(owner: TerminalOwner, bounds: TerminalBounds): void {
    for (const [label, value] of Object.entries({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })) integer(value, label)
    if (bounds.width === 0 || bounds.height === 0) return
    this.resize(bounds.x + bounds.width, bounds.y + bounds.height)
    const remembered = this.remember(owner)!, key = ownerKey(remembered)
    const previous = this.declared.get(key)
    this.declared.set(key, previous ? union(previous, bounds) : { ...bounds })
  }

  port(owner: TerminalOwner, port: TerminalPort): void {
    integer(port.x, 'port x'); integer(port.y, 'port y')
    const key = ownerKey(this.remember(owner)!)
    const ports = this.ports.get(key) ?? []
    if (!ports.some(existing => existing.end === port.end && existing.nodeId === port.nodeId)) ports.push({ ...port })
    this.ports.set(key, ports)
    this.resize(port.x + 1, port.y + 1)
  }

  report(diagnostic: TerminalProjectionDiagnostic): void {
    const key = `${diagnostic.code}:${diagnostic.feature}`
    if (!this.diagnosticKeys.has(key)) { this.diagnosticKeys.add(key); this.diagnostics.push(diagnostic) }
  }

  private warn(code: TerminalCompositionDiagnostic['code'], owners: readonly TerminalOwner[], x: number, y: number): void {
    const feature = owners.map(owner => `${owner.kind ?? 'node'}:${owner.id}`).sort(compareCodePointStrings).join('|')
    const key = `${code}:${feature}`
    if (this.diagnosticKeys.has(key)) return
    this.diagnosticKeys.add(key)
    const description = code === 'TERMINAL_TEXT_COLLISION' ? 'Text footprints overlap' : code === 'TERMINAL_ROUTE_OVERLAP' ? 'Unrelated route runs overlap' : 'Incompatible occupied geometry overlaps'
    this.diagnostics.push({ code, feature, message: `${description} at terminal cell (${x}, ${y}); owners: ${owners.map(owner => owner.id).join(', ')}.` })
  }

  private retire(x: number, y: number): void {
    const row = this.rows.get(y), old = row?.get(x)
    if (!row || !old) return
    for (let cell = old.head; cell < old.head + old.width; cell++) row.delete(cell)
  }

  put(x: number, y: number, glyph: string, paint: TerminalPaint = {}): void {
    integer(x, 'x'); integer(y, 'y')
    if (!glyph) return
    if (glyph === WIDE_CHAR_CONTINUATION) return
    glyph = sanitizeTerminalText(glyph, true)
    if (glyph.length !== 1 || charVisualWidth(glyph) !== 1) { this.text(x, y, glyph, paint); return }
    const owner = this.remember(paint.owner ?? this.activeOwner)
    const kind = paint.kind ?? 'stroke'
    if (glyph === ' ' && kind === 'stroke' && !owner) { this.resize(x + 1, y + 1); return }
    this.place(x, y, glyph, 1, { ...paint, owner, kind }, undefined)
  }

  private place(x: number, y: number, glyph: string, width: number, paint: TerminalPaint, block: TextBlock | undefined): boolean {
    const old = this.cell(x, y), incoming = paint.owner ? [paint.owner] : []
    let owners: readonly TerminalOwner[] = incoming
    // Admission is atomic over the full incoming grapheme, including a wide
    // head whose second cell encounters another owner's text.
    for (let offset = 0; offset < width; offset++) {
      const covered = this.cell(x + offset, y)
      if (covered?.kind !== 'text') continue
      const unrelated = incoming.length > 0 && covered.owners.length > 0 && !covered.owners.some(owner => ownerKey(owner) === ownerKey(incoming[0]!))
      if (unrelated) this.warn('TERMINAL_TEXT_COLLISION', [...covered.owners, ...incoming], x + offset, y)
      if (unrelated || paint.kind !== 'text') return false
    }
    const related = old?.owners.some(previous => incoming.some(next => ownerKey(previous) === ownerKey(next) || (previous.bundle && previous.bundle === next.bundle))) ?? false
    if (old?.kind === 'surface' && old.owners.length && incoming.length && !related) {
      this.warn('TERMINAL_GEOMETRY_COLLISION', [...old.owners, ...incoming], x, y)
      return false
    }
    if (old?.kind === 'marker') {
      if (paint.kind === 'marker' && old.glyph === glyph) owners = [...old.owners, ...incoming.filter(next => !old.owners.some(previous => ownerKey(previous) === ownerKey(next)))]
      else if (!related || (paint.kind !== 'text' && paint.kind !== 'surface')) {
        if (!related && incoming.length) this.warn('TERMINAL_GEOMETRY_COLLISION', [...old.owners, ...incoming], x, y)
        return false
      }
    }
    if (old?.kind === 'stroke' && paint.kind === 'stroke') {
      const unicode = asciiPorts[old.glyph] === undefined && asciiPorts[glyph] === undefined
      const a = strokePorts[old.glyph] ?? styledPorts[old.glyph] ?? asciiPorts[old.glyph], b = strokePorts[glyph] ?? styledPorts[glyph] ?? asciiPorts[glyph]
      if (a && b && a !== b) glyph = unicode ? portGlyph.get(a | b) ?? glyph : '+'
      owners = [...old.owners, ...incoming.filter(owner => !old.owners.some(other => ownerKey(other) === ownerKey(owner)))]
      if (old.owners.length > 0 && incoming.length > 0 && old.owners.some(previous => {
        const next = incoming[0]!
        return previous.kind === 'edge' && next.kind === 'edge' && previous.id !== next.id
          && !(previous.bundle && previous.bundle === next.bundle) && a !== undefined && a === b
      })) this.warn('TERMINAL_ROUTE_OVERLAP', owners, x, y)
    }
    for (let offset = 0; offset < width; offset++) this.retire(x + offset, y)
    this.resize(x + width, y + 1)
    let row = this.rows.get(y)
    if (!row) { row = new Map(); this.rows.set(y, row) }
    const cell: TerminalCell = { ...paint, glyph, owners, head: x, width, ...(block ? { textBlock: block } : {}) }
    row.set(x, cell)
    for (let offset = 1; offset < width; offset++) row.set(x + offset, { ...cell, glyph: WIDE_CHAR_CONTINUATION })
    this.metrics.writes += width
    return true
  }

  text(x: number, y: number, text: string, paint: TerminalPaint = {}): TerminalBounds {
    integer(x, 'x'); integer(y, 'y')
    const owner = this.remember(paint.owner ?? this.activeOwner)
    text = sanitizeTerminalText(text, true)
    const lines = text.split('\n')
    const bounds = { x, y, width: Math.max(0, ...lines.map(visualWidth)), height: lines.length }
    const kind = paint.kind ?? 'text'
    const scoped = kind === 'text' && owner !== undefined && owner === this.activeOwner
    const groupKey = paint.textGroup === undefined ? undefined : `${owner ? ownerKey(owner) : ''}\0${paint.textGroup}`
    let block = groupKey === undefined ? scoped ? this.activeTextBlock : undefined : this.textGroups.get(groupKey)
    if (block) Object.assign(block, union(block, bounds))
    else { block = { ...bounds }; if (scoped) this.activeTextBlock = block; if (groupKey !== undefined) this.textGroups.set(groupKey, block) }
    lines.forEach((line, offsetY) => {
      let column = x
      for (const cluster of graphemes(line)) {
        const width = visualWidth(cluster)
        if (width > 0) {
          this.place(column, y + offsetY, cluster, width, { ...paint, owner, role: paint.role === undefined ? 'text' : paint.role, kind }, kind === 'text' ? block : undefined)
          column += width
        }
      }
    })
    this.resize(x + bounds.width, y + bounds.height)
    return bounds
  }

  fill(x: number, y: number, width: number, height: number, paint: TerminalPaint = {}): void {
    for (const [label, value] of Object.entries({ x, y, width, height })) integer(value, label)
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) this.put(col, row, ' ', { ...paint, kind: 'surface' })
  }

  line(runs: readonly TerminalRun[] = []): void {
    const y = this.height
    this.lineWidths ??= Array.from({ length: this.height }, () => this.width)
    let x = 0
    for (const run of runs) {
      this.text(x, y, run.text, run)
      x += visualWidth(run.text)
    }
    this.resize(x, y + 1)
    this.lineWidths[y] = x
  }

  /** A sparse empty layer with the same extent, suitable for positioned drawing. */
  blank(): TerminalDocument { return new TerminalDocument(this.width, this.height) }

  overlay(other: TerminalDocument, dx = 0, dy = 0): void {
    integer(dx, 'offset x'); integer(dy, 'offset y')
    this.resize(dx + other.width, dy + other.height)
    this.titleHandled ||= other.titleHandled
    if (other.lineWidths) {
      this.lineWidths ??= Array.from({ length: this.height }, () => this.width)
      for (let y = 0; y < other.height; y++) this.lineWidths[y + dy] = Math.max(this.lineWidths[y + dy] ?? 0, dx + (other.lineWidths[y] ?? other.width))
    }
    const blocks = new Map<TextBlock, TextBlock>()
    for (const [y, row] of other.rows) for (const [x, cell] of row) {
      if (cell.glyph === WIDE_CHAR_CONTINUATION) continue
      this.metrics.overlayVisits++
      let block: TextBlock | undefined
      if (cell.textBlock) {
        block = blocks.get(cell.textBlock)
        if (!block) { block = { ...cell.textBlock, x: cell.textBlock.x + dx, y: cell.textBlock.y + dy }; blocks.set(cell.textBlock, block) }
      }
      const owner = this.remember(cell.owner ?? this.activeOwner)
      if (block && !cell.owner && this.activeOwner) {
        if (this.activeTextBlock) Object.assign(this.activeTextBlock, union(this.activeTextBlock, block))
        else this.activeTextBlock = block
        block = this.activeTextBlock
      }
      if (!this.place(x + dx, y + dy, cell.glyph, cell.width, { ...cell, owner }, block)) continue
      const placed = this.cell(x + dx, y + dy)
      if (placed) {
        const owners = [...new Map([...placed.owners, ...cell.owners.map(owner => this.remember(owner)!)].map(owner => [ownerKey(owner), owner])).values()]
        for (let offset = 0; offset < cell.width; offset++) this.cell(x + dx + offset, y + dy)!.owners = owners
      }
    }
    for (const owner of other.owners.values()) this.remember(owner)
    for (const [key, bounds] of other.declared) this.region(other.owners.get(key)!, { ...bounds, x: bounds.x + dx, y: bounds.y + dy })
    for (const [key, ports] of other.ports) for (const port of ports) this.port(other.owners.get(key)!, { ...port, x: port.x + dx, y: port.y + dy })
    for (const diagnostic of other.diagnostics) this.report(diagnostic)
  }

  /** Reflect positioned primitives. Text blocks retain their reading order. */
  flip(horizontal: boolean, vertical: boolean): void {
    const next = new Map<number, Map<number, TerminalCell>>()
    const blocks = new Map<TextBlock, TextBlock>()
    for (const [y, row] of this.rows) for (const [x, cell] of row) {
      if (cell.glyph === WIDE_CHAR_CONTINUATION) continue
      let nx = horizontal ? this.width - cell.width - x : x
      let ny = vertical ? this.height - 1 - y : y
      let block: TextBlock | undefined
      let glyph = cell.glyph
      if (cell.kind === 'text' && cell.textBlock) {
        const old = cell.textBlock
        block = blocks.get(old)
        if (!block) {
          block = { ...old, x: horizontal ? this.width - old.x - old.width : old.x, y: vertical ? this.height - old.y - old.height : old.y }
          blocks.set(old, block)
        }
        nx = block.x + x - old.x; ny = block.y + y - old.y
      } else {
        if (horizontal) glyph = flipXGlyph[glyph] ?? glyph
        if (vertical) glyph = flipYGlyph[glyph] ?? glyph
      }
      let target = next.get(ny)
      if (!target) { target = new Map(); next.set(ny, target) }
      const placed = { ...cell, glyph, head: nx, ...(block ? { textBlock: block } : {}) }
      target.set(nx, placed)
      for (let offset = 1; offset < cell.width; offset++) target.set(nx + offset, { ...placed, glyph: WIDE_CHAR_CONTINUATION })
    }
    this.rows = next
    for (const bounds of this.declared.values()) {
      if (horizontal) bounds.x = this.width - bounds.x - bounds.width
      if (vertical) bounds.y = this.height - bounds.y - bounds.height
    }
    for (const ports of this.ports.values()) for (const port of ports) {
      if (horizontal) { port.x = this.width - 1 - port.x; if (port.side === 'L') port.side = 'R'; else if (port.side === 'R') port.side = 'L' }
      if (vertical) { port.y = this.height - 1 - port.y; if (port.side === 'T') port.side = 'B'; else if (port.side === 'B') port.side = 'T' }
    }
    this.activeTextBlock = undefined
    this.textGroups.clear()
    this.emittedWidths = undefined
    if (vertical) this.lineWidths?.reverse()
  }

  serialize(options: TerminalSerializeOptions = {}): string {
    this.metrics.outputCells = 0
    const mode = options.colorMode ?? 'none', theme = options.theme ?? DEFAULT_ASCII_THEME
    const lines: string[] = [], widths: number[] = []
    for (let y = 0; y < this.height; y++) {
      const rowWidth = this.lineWidths?.[y] ?? this.width
      let width = rowWidth
      if (options.trimEnd) while (width > 0 && this.get(width - 1, y) === ' ' && this.cell(width - 1, y)?.kind !== 'text') width--
      widths.push(width)
      let line = '', buffer = '', lastRole: CharRole | null | undefined, lastColor: string | undefined
      const flush = (): void => {
        if (!buffer) return
        line += lastColor ? colorizeText(buffer, lastColor, mode) : colorizeLine([buffer], [lastRole ?? null], theme, mode)
        buffer = ''
      }
      for (let x = 0; x < width; x++) {
        const cell = this.cell(x, y), glyph = cell?.glyph ?? ' '
        if (glyph === WIDE_CHAR_CONTINUATION) continue
        if (glyph === ' ') { flush(); line += ' '; lastRole = undefined; lastColor = undefined; continue }
        const role = cell?.role ?? null, color = cell?.color
        if (role !== lastRole || color !== lastColor) { flush(); lastRole = role; lastColor = color }
        buffer += glyph
      }
      flush(); lines.push(line)
      this.metrics.outputCells += width
    }
    if (options.trimEnd) while (lines.length > 0 && widths.at(-1) === 0) { lines.pop(); widths.pop() }
    this.emittedWidths = widths
    return lines.join('\n')
  }

  regions(): TerminalRegion[] {
    const groups = new Map<string, { owner: TerminalOwner; cells: Array<{ x: number; y: number; cell: TerminalCell }> }>()
    for (const [y, row] of this.rows) for (const [x, cell] of row) {
      if (this.emittedWidths && (y >= this.emittedWidths.length || x >= this.emittedWidths[y]!)) continue
      for (const owner of cell.owners) {
        const key = ownerKey(owner)
        let group = groups.get(key)
        if (!group) { group = { owner, cells: [] }; groups.set(key, group) }
        group.cells.push({ x, y, cell })
      }
    }
    for (const [key] of this.declared) if (!groups.has(key)) groups.set(key, { owner: this.owners.get(key)!, cells: [] })
    const result: TerminalRegion[] = []
    for (const [key, { owner, cells }] of groups) {
      const text = cells.filter(item => item.cell.kind === 'text')
      const firstBlock = [...text].sort((a, b) => a.y - b.y || a.x - b.x)[0]?.cell.textBlock
      const label = firstBlock ? text.filter(item => item.cell.textBlock === firstBlock) : text
      const selected = owner.kind === 'edge' ? cells : label.length > 0 ? label : cells
      const declared = this.declared.get(key)
      if (selected.length === 0 && !declared) continue
      const bounds = declared ?? selected.reduce<TerminalBounds | undefined>((previous, item) => {
        const cellBounds = { x: item.x, y: item.y, width: 1, height: 1 }
        return previous ? union(previous, cellBounds) : cellBounds
      }, undefined)!
      const ordered = [...cells].sort((a, b) => a.y - b.y || a.x - b.x)
      const spans: TerminalCellSpan[] = []
      for (const { x, y } of ordered) {
        const last = spans.at(-1)
        if (last && last.row === y && last.end === x) last.end++
        else spans.push({ row: y, start: x, end: x + 1 })
      }
      const authored = label.filter(({ cell }) => cell.glyph !== WIDE_CHAR_CONTINUATION)
        .sort((a, b) => a.y - b.y || a.x - b.x)
      const visible = label.filter(({ cell }) => cell.glyph !== WIDE_CHAR_CONTINUATION).sort((a, b) => a.y - b.y || a.x - b.x)
      let projectedText = '', previousRow: number | undefined
      for (const item of visible) { if (previousRow !== undefined && previousRow !== item.y) projectedText += '\n'; projectedText += item.cell.glyph; previousRow = item.y }
      result.push({
        id: owner.id, kind: owner.kind ?? 'node',
        ...(owner.sourceLine === undefined ? {} : { sourceLine: owner.sourceLine }),
        ...(owner.parentId === undefined ? {} : { parentId: owner.parentId }),
        ...(owner.members === undefined ? {} : { members: owner.members }),
        ...(owner.from === undefined ? {} : { from: owner.from }),
        ...(owner.to === undefined ? {} : { to: owner.to }),
        ...(owner.bundle === undefined ? {} : { bundle: owner.bundle }),
        ...(this.ports.has(key) ? { ports: this.ports.get(key)!.map(port => ({ ...port })) } : {}),
        canvasRow: bounds.y, canvasColStart: bounds.x, canvasColEnd: bounds.x + bounds.width,
        ...(bounds.height > 1 ? { rowSpan: bounds.height } : {}),
        ...(authored.length === 0 ? {} : { projectedText, authoredTextCells: authored.map(({ x, y, cell }) => ({ row: y, column: x, glyph: cell.glyph })) }),
        ownedCellSpans: spans,
      })
    }
    return result.sort((a, b) => a.canvasRow - b.canvasRow || a.canvasColStart - b.canvasColStart || compareCodePointStrings(a.id, b.id))
  }
}

interface TerminalCapture { document?: TerminalDocument; output?: string }
const captureKey = Symbol('terminal drawing')
type CapturedConfig = object & { [captureKey]?: TerminalCapture }
const artifacts = new WeakMap<object, TerminalDocument>()

/** The private symbol follows ordinary config spreads, without a public hook. */
export function beginTerminalCapture(config: object): void {
  Object.defineProperty(config, captureKey, { value: {}, enumerable: true, configurable: true })
}
export function capturedTerminalDocument(config: object, output?: string): TerminalDocument | undefined {
  const capture = (config as CapturedConfig)[captureKey]
  return output === undefined || capture?.output === output ? capture?.document : undefined
}
export function finishTerminalDocument(config: object, document: TerminalDocument, options: TerminalSerializeOptions = {}): string {
  const capture = (config as CapturedConfig)[captureKey]
  const output = document.serialize(options)
  if (capture) { capture.document = document; capture.output = output }
  return output
}
export function retainTerminalDocument(result: object, document: TerminalDocument | undefined): void { if (document) artifacts.set(result, document) }
export function terminalDocumentOf(result: object): TerminalDocument | undefined { return artifacts.get(result) }
