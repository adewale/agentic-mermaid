import type { RenderedRegionKind } from '../agent/types.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { graphemes } from '../shared/graphemes.ts'
import { observeWork } from '../performance-observations.ts'
import { sanitizeTerminalText } from '../terminal-security.ts'
import type { TerminalProjectionDiagnostic } from '../terminal-style.ts'
import { colorizeLine, colorizeText, DEFAULT_ASCII_THEME } from './ansi.ts'
import { TERMINAL_CERTIFICATION_LIMITS } from './terminal-limits.ts'
import { terminalPathAdmission } from './terminal-route.ts'
import type { AsciiTheme, CharRole, ColorMode } from './types.ts'
import { charVisualWidth, visualWidth, WIDE_CHAR_CONTINUATION } from './width.ts'

export interface TerminalPathWitness {
  readonly owner: TerminalOwner
  readonly token: object
  readonly dx: number
  readonly dy: number
}
interface PathWitnessState {
  work: number
  witnesses: Map<string, Readonly<TerminalPathWitness> | null>
}
const pathWitnessStates = new WeakMap<TerminalDocument, PathWitnessState>()

export interface TerminalIdentity {
  id: string
  kind: Exclude<RenderedRegionKind, 'canvas'> | 'subgraph'
}
export interface TerminalOwner {
  id: string
  kind?: TerminalIdentity['kind']
  sourceLine?: number
  parent?: Readonly<TerminalIdentity>
  /** Semantic attachment only; grants no containment or geometry privileges. */
  annotationTarget?: Readonly<TerminalIdentity>
  members?: readonly string[]
  /** Shared runs may join only when their family layout declares a bundle. */
  bundle?: string
  from?: string
  to?: string
  /** Producer promises a complete visible directional connector between its ports. */
  route?: 'connected'
}

export interface TerminalBounds {
  x: number
  y: number
  width: number
  height: number
}
declare const ownerSetBrand: unique symbol
declare const elementBrand: unique symbol
export type TerminalElement = Readonly<TerminalOwner> & { readonly [elementBrand]: true }
export type TerminalOwnerSet = readonly TerminalOwner[] & { readonly [ownerSetBrand]: true }
export type TerminalSide = 'T' | 'R' | 'B' | 'L'
export const TERMINAL_STROKE_PORTS = { T: 1, R: 2, B: 4, L: 8 } as const
export type TerminalLineStyle = 'solid' | 'dashed' | 'dotted' | 'heavy' | 'double'
export interface TerminalStroke {
  mask: number
  ascii?: boolean
  style?: TerminalLineStyle
  rounded?: boolean
}
export interface TerminalMarker {
  shape: 'arrow' | 'triangle' | 'open-arrow' | 'circle' | 'cross' | 'diamond' | 'wide-circle' | 'lollipop' | 'filled-diamond' | 'hollow-diamond' | 'sequence-cross' | 'half-top' | 'half-bottom' | 'stick-top' | 'stick-bottom' | 'cardinality-one' | 'cardinality-many'
  direction?: TerminalSide
  ascii?: boolean
}
export interface TerminalNumericMark {
  axis: 'horizontal' | 'vertical'
  coverage: 1 | 2 | 3
  ascii?: boolean
}
const measuredBrand = Symbol('measured terminal text')
export interface MeasuredTerminalText {
  readonly [measuredBrand]: true
  readonly width: number
  readonly height: number
  readonly emptyRows: readonly number[]
  readonly lines: readonly (readonly { readonly glyph: string; readonly x: number; readonly width: number }[])[]
}
export interface AllocatedTerminalText extends TerminalBounds {
  readonly text: MeasuredTerminalText
}

/** Sanitize and measure once, before choosing a position or testing occupancy. */
export function measuredText(value: string | readonly string[]): MeasuredTerminalText {
  const rows = sanitizeTerminalText(typeof value === 'string' ? value : value.join('\n'), true).split('\n')
  let maximum = 0
  const lines = rows.map(line => {
    let x = 0
    const clusters = [...graphemes(line)].flatMap(glyph => {
      const width = visualWidth(glyph)
      if (!width) return []
      const cluster = Object.freeze({ glyph, x, width })
      x += width
      return [cluster]
    })
    maximum = Math.max(maximum, x)
    return Object.freeze(clusters)
  })
  return Object.freeze({ [measuredBrand]: true as const, width: maximum, height: lines.length, emptyRows: Object.freeze(rows.flatMap((row, index) => (row.length === 0 ? [index] : []))), lines: Object.freeze(lines) })
}
export interface TerminalPaint {
  owner?: TerminalOwner
  owners?: TerminalOwnerSet | readonly TerminalOwner[]
  role?: CharRole | null
  color?: string
  kind?: 'text' | 'stroke' | 'marker' | 'surface' | 'mark'
  /** Explicit logical text occurrence, for interleaved wrapped table columns. */
  textGroup?: string
  stroke?: TerminalStroke
  marker?: TerminalMarker
  numericMark?: TerminalNumericMark
}
export interface TerminalRun extends TerminalPaint {
  text: string
}
export interface TerminalSerializeOptions {
  colorMode?: ColorMode
  theme?: AsciiTheme
  trimEnd?: boolean
}
export interface TerminalTextAllocation {
  readonly x: number
  readonly y: number
  readonly text: MeasuredTerminalText
  readonly owners: TerminalOwnerSet
  readonly attributions?: readonly Readonly<{ bounds: TerminalBounds; owners: TerminalOwnerSet }>[]
}

interface TextBlock extends TerminalBounds {
  allocations?: TerminalTextAllocation[]
  /** Authored empty rows carry meaning but never fabricate occupied cells. */
  emptyRows?: Map<number, TerminalOwnerSet>
}
// Private snapshots survive internal spreads, but are not inferred from merged ink.
// Single-contribution cells retain two scalars/references, without a new record.
const strokeContributors = Symbol('terminal stroke contributors')
const strokeContributions = Symbol('terminal stroke contributions')
export interface TerminalCell extends TerminalPaint {
  [strokeContributors]?: TerminalOwnerSet
  [strokeContributions]?: number | readonly number[]
  glyph: string
  owners: TerminalOwnerSet
  head: number
  width: number
  textBlock?: TextBlock
  stroke?: TerminalStroke
  marker?: TerminalMarker
  numericMark?: TerminalNumericMark
  occludedOwners?: TerminalOwnerSet
}
export interface TerminalCellSpan {
  row: number
  start: number
  end: number
}
export interface TerminalPort {
  nodeId: string
  x: number
  y: number
  side?: TerminalSide
  end: 'start' | 'end'
  /** Authored item identity stays in nodeId when a container is the physical contact. */
  boundary?: Readonly<TerminalIdentity>
  /** Model-owned expectation, declared separately from painting. Empty means
   * deliberately unmarked; multiple cells retain ER cardinality semantics. */
  markers?: readonly Readonly<TerminalMarker>[]
  markerOffset?: number
  /** A declared family loss, backed by a diagnostic and owned fallback text. */
  markerProjection?: string
  /** Sequence contacts a participant lifeline, not its header-card frame. */
  surface?: 'frame' | 'lifeline'
}

/** Ports retain independent immutable marker definitions across allocation and import. */
export function snapshotTerminalPort<T extends TerminalPort>(port: T): T {
  const snapshot = { ...port }
  if (snapshot.boundary) snapshot.boundary = Object.freeze({ ...snapshot.boundary })
  if (snapshot.markers) snapshot.markers = Object.freeze(snapshot.markers.map(marker => Object.freeze({ ...marker })))
  return snapshot
}

export interface TerminalRegion {
  id: string
  kind: NonNullable<TerminalOwner['kind']>
  sourceLine?: number
  parentId?: string
  parentKind?: TerminalIdentity['kind']
  annotationTarget?: Readonly<TerminalIdentity>
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
  /** Relationship coverage hidden behind opaque marks; not visible ink. */
  occludedCellSpans?: TerminalCellSpan[]
}
export interface TerminalCompositionDiagnostic {
  code: 'TERMINAL_TEXT_COLLISION' | 'TERMINAL_ROUTE_OVERLAP' | 'TERMINAL_GEOMETRY_COLLISION'
  feature: string
  message: string
}

const ownerKey = (owner: TerminalOwner): string => `${owner.kind ?? 'node'}\0${owner.id}`
const geometryRelated = (a: TerminalOwner, b: TerminalOwner): boolean => ownerKey(a) === ownerKey(b) || !!(a.bundle && a.bundle === b.bundle) || !!(a.parent && ownerKey(a.parent) === ownerKey(b)) || !!(b.parent && ownerKey(b.parent) === ownerKey(a))
const textGroupKey = (owner: TerminalOwner | undefined, group: string | undefined): string | undefined => (group === undefined ? undefined : JSON.stringify([owner ? [owner.kind ?? 'node', owner.id] : null, group]))
// Only snapshots created by this module may back identity-based import caches.
const canonicalOwnerDefinitions = new WeakSet<TerminalOwner>()
const canonicalOwnerSets = new WeakSet<readonly TerminalOwner[]>()
const emptyOwners = Object.freeze([]) as unknown as TerminalOwnerSet
canonicalOwnerSets.add(emptyOwners)
const definitionFields = ['sourceLine', 'parent', 'annotationTarget', 'bundle', 'from', 'to', 'members', 'route'] as const

function snapshotOwner(owner: TerminalOwner): TerminalOwner {
  if (canonicalOwnerDefinitions.has(owner)) return owner
  const snapshot = { ...owner }
  if (snapshot.parent) snapshot.parent = Object.freeze({ ...snapshot.parent })
  if (snapshot.annotationTarget) snapshot.annotationTarget = Object.freeze({ ...snapshot.annotationTarget })
  if (snapshot.members) snapshot.members = Object.freeze([...snapshot.members])
  Object.freeze(snapshot)
  canonicalOwnerDefinitions.add(snapshot)
  return snapshot
}

function validateOwner(previous: TerminalOwner, incoming: TerminalOwner): void {
  for (const field of definitionFields) {
    const value = incoming[field]
    if (value !== undefined && (field === 'members' ? JSON.stringify(value) !== JSON.stringify(previous[field]) : field === 'parent' || field === 'annotationTarget' ? ownerKey(value as TerminalIdentity) !== (previous[field] ? ownerKey(previous[field]) : undefined) : value !== previous[field]))
      throw new Error(`Inconsistent terminal element ${incoming.id}: ${field}`)
  }
}
const strokePorts: Readonly<Record<string, number>> = {
  '─': 10,
  '│': 5,
  '┌': 6,
  '┐': 12,
  '└': 3,
  '┘': 9,
  '├': 7,
  '┤': 13,
  '┬': 14,
  '┴': 11,
  '┼': 15,
  '╴': 8,
  '╵': 1,
  '╶': 2,
  '╷': 4,
}
const portGlyph = new Map(Object.entries(strokePorts).map(([glyph, ports]) => [ports, glyph]))
const styledPorts: Readonly<Record<string, number>> = { '┄': 10, '╌': 10, '┈': 10, '━': 10, '═': 10, '┆': 5, '┊': 5, '╎': 5, '┃': 5, '║': 5, '╔': 6, '╗': 12, '╚': 3, '╝': 9 }
const asciiPorts: Readonly<Record<string, number>> = { '-': 10, '=': 10, '.': 10, '|': 5, ':': 5, '+': 15 }

/** Cardinal contacts of the emitted glyph. ASCII shafts and junctions expose
 * their complete visible axes even when a semantic stroke has one port. */
export function terminalCellConnections(cell: Readonly<TerminalCell>): number {
  if (cell.kind === 'stroke') return strokePorts[cell.glyph] ?? styledPorts[cell.glyph] ?? asciiPorts[cell.glyph] ?? 0
  if (cell.kind !== 'marker' || !cell.marker) return 0
  if (cell.marker.shape === 'arrow') return cell.marker.direction === 'T' || cell.marker.direction === 'B' ? 5 : 10
  return cell.marker.shape === 'wide-circle' || cell.marker.shape === 'cross' ? 15 : 0
}
/** A retained direction belongs only to the owner that actually painted it. */
export function terminalOwnedStrokeMask(cell: Readonly<TerminalCell>, index: number): number {
  if (cell.kind !== 'stroke' || cell[strokeContributors] !== cell.owners) return 0
  const masks = cell[strokeContributions]
  return typeof masks === 'number' ? (masks === (cell.stroke?.mask ?? strokePorts[cell.glyph] ?? styledPorts[cell.glyph] ?? asciiPorts[cell.glyph] ?? 0) ? masks : 0) : (masks?.[index] ?? 0)
}

/** The final scan independently compares the owner union with current ink. */
export function terminalStrokeProvenanceMatches(cell: Readonly<TerminalCell>, union: number): boolean {
  const masks = cell[strokeContributions]
  return cell[strokeContributors] === cell.owners && masks !== undefined && (typeof masks === 'number' ? masks === union : masks.length === cell.owners.length) && union === (cell.stroke?.mask ?? strokePorts[cell.glyph] ?? styledPorts[cell.glyph] ?? asciiPorts[cell.glyph] ?? 0)
}

const flipXGlyph: Readonly<Record<string, string>> = {
  '>': '<',
  '<': '>',
  '►': '◄',
  '◄': '►',
  '▶': '◀',
  '◀': '▶',
  '┌': '┐',
  '┐': '┌',
  '└': '┘',
  '┘': '└',
  '├': '┤',
  '┤': '├',
  '╭': '╮',
  '╮': '╭',
  '╰': '╯',
  '╯': '╰',
  '╴': '╶',
  '╶': '╴',
  '╔': '╗',
  '╗': '╔',
  '╚': '╝',
  '╝': '╚',
  '◁': '▷',
  '▷': '◁',
}
const flipYGlyph: Readonly<Record<string, string>> = {
  '^': 'v',
  v: '^',
  '▲': '▼',
  '▼': '▲',
  '◤': '◣',
  '◣': '◤',
  '◥': '◢',
  '◢': '◥',
  '┌': '└',
  '└': '┌',
  '┐': '┘',
  '┘': '┐',
  '┬': '┴',
  '┴': '┬',
  '╭': '╰',
  '╰': '╭',
  '╮': '╯',
  '╯': '╮',
  '╵': '╷',
  '╷': '╵',
  '╔': '╚',
  '╚': '╔',
  '╗': '╝',
  '╝': '╗',
  '△': '▽',
  '▽': '△',
}

function strokeGlyph(stroke: TerminalStroke): string {
  const { mask, ascii = false, style = 'solid' } = stroke
  const horizontal = (mask & 10) !== 0,
    vertical = (mask & 5) !== 0
  if (ascii) return horizontal && vertical ? '+' : horizontal ? (style === 'dashed' || style === 'dotted' ? '.' : style === 'double' || style === 'heavy' ? '=' : '-') : style === 'dashed' || style === 'dotted' ? ':' : '|'
  if (stroke.rounded && !ascii && (mask === 6 || mask === 12 || mask === 3 || mask === 9)) return ({ 6: '╭', 12: '╮', 3: '╰', 9: '╯' } as Record<number, string>)[mask]!
  if (style === 'double') return ({ 10: '═', 5: '║', 6: '╔', 12: '╗', 3: '╚', 9: '╝', 7: '╠', 13: '╣', 14: '╦', 11: '╩', 15: '╬' } as Record<number, string>)[mask] ?? portGlyph.get(mask) ?? '─'
  if (style === 'heavy' && mask === 10) return '━'
  if (style === 'heavy' && mask === 5) return '┃'
  if (style === 'dashed' && mask === 10) return '╌'
  if (style === 'dashed' && mask === 5) return '┊'
  if (style === 'dotted' && mask === 10) return '┄'
  if (style === 'dotted' && mask === 5) return '┆'
  return portGlyph.get(mask) ?? '┼'
}
function markerGlyph(marker: TerminalMarker): string {
  const direction = marker.direction ?? 'R',
    index = ['T', 'R', 'B', 'L'].indexOf(direction)
  const right = direction === 'R',
    horizontal = direction === 'R' || direction === 'L'
  if (marker.shape === 'sequence-cross') return 'X'
  if (marker.shape === 'half-top') return right ? (marker.ascii ? '/' : '◜') : marker.ascii ? '\\' : '◝'
  if (marker.shape === 'half-bottom') return right ? (marker.ascii ? '\\' : '◟') : marker.ascii ? '/' : '◞'
  if (marker.shape === 'stick-top') return right ? '/' : '\\'
  if (marker.shape === 'stick-bottom') return right ? '\\' : '/'
  if (marker.shape === 'wide-circle') return marker.ascii ? 'o' : '◯'
  if (marker.shape === 'lollipop') return marker.ascii ? 'O' : '○'
  if (marker.shape === 'filled-diamond') return marker.ascii ? '*' : '◆'
  if (marker.shape === 'hollow-diamond') return marker.ascii ? 'o' : '◇'
  if (marker.shape === 'cardinality-one') return horizontal ? (marker.ascii ? '|' : '│') : marker.ascii ? '-' : '─'
  if (marker.shape === 'cardinality-many') return (marker.ascii ? ['^', '>', 'v', '<'] : ['┴', '╢', '┬', '╟'])[index]!
  if (marker.shape === 'circle') return marker.ascii ? 'o' : '○'
  if (marker.shape === 'cross') return marker.ascii ? 'x' : '✕'
  if (marker.shape === 'diamond') return marker.ascii ? 'o' : '◆'
  if (marker.ascii) return ['^', '>', 'v', '<'][index]!
  return (marker.shape === 'open-arrow' ? ['△', '▷', '▽', '◁'] : marker.shape === 'triangle' ? ['▲', '▶', '▼', '◀'] : ['▲', '►', '▼', '◄'])[index]!
}
function reflectedMarker(marker: Readonly<TerminalMarker>, horizontal: boolean, vertical: boolean): Readonly<TerminalMarker> {
  let direction = marker.direction ?? 'R',
    shape = marker.shape
  if (horizontal && (direction === 'L' || direction === 'R')) direction = direction === 'L' ? 'R' : 'L'
  if (vertical && (direction === 'T' || direction === 'B')) direction = direction === 'T' ? 'B' : 'T'
  if (vertical) shape = shape === 'half-top' ? 'half-bottom' : shape === 'half-bottom' ? 'half-top' : shape === 'stick-top' ? 'stick-bottom' : shape === 'stick-bottom' ? 'stick-top' : shape
  return Object.freeze({ ...marker, shape, direction })
}
function numericMarkGlyph(mark: TerminalNumericMark): string {
  return mark.ascii ? '#' : mark.coverage === 3 ? '█' : mark.axis === 'horizontal' ? (mark.coverage === 1 ? '▌' : '▐') : mark.coverage === 1 ? '▄' : '▀'
}
/** Expected glyph from a retained typed terminal primitive, before output encoding. */
export function terminalGlyphForPaint(paint: Pick<TerminalPaint, 'stroke' | 'marker' | 'numericMark'>): string | undefined {
  return paint.marker ? markerGlyph(paint.marker) : paint.numericMark ? numericMarkGlyph(paint.numericMark) : paint.stroke ? strokeGlyph(paint.stroke) : undefined
}

function reflectedMask(mask: number, horizontal: boolean, vertical: boolean): number {
  if (horizontal) mask = (mask & 5) | ((mask & 2) << 2) | ((mask & 8) >> 2)
  if (vertical) mask = (mask & 10) | ((mask & 1) << 2) | ((mask & 4) >> 2)
  return mask
}

function integer(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a nonnegative integer terminal coordinate`)
}
function union(a: TerminalBounds, b: TerminalBounds): TerminalBounds {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y)
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
  private elements = new Map<string, TerminalOwner>()
  private ownerSets = new Map<string, TerminalOwnerSet>()
  private singletonOwners = new WeakMap<TerminalOwner, TerminalOwnerSet>()
  private importedOwners = new WeakMap<readonly TerminalOwner[], TerminalOwnerSet>()
  private canonicalOwners = new WeakSet<TerminalOwner>()
  private ownerKeys = new WeakMap<TerminalOwner, string>()
  private ownerUnions = new WeakMap<TerminalOwnerSet, WeakMap<TerminalOwnerSet, TerminalOwnerSet>>()
  private warningFeatures = new WeakMap<TerminalOwnerSet, { feature: string; keys: Partial<Record<TerminalCompositionDiagnostic['code'], string>> }>()
  private declared = new Map<string, TerminalBounds>()
  private ports = new Map<string, TerminalPort[]>()
  private activeOwner: TerminalOwner | undefined
  private activeTextBlock: TextBlock | undefined
  private textGroups = new Map<string, TextBlock>()
  private retainedTextBlocks = new Set<TextBlock>()
  private diagnosticKeys = new Set<string>()
  private diagnosticIdentities = new WeakMap<TerminalProjectionDiagnostic, string>()
  private lineWidths: number[] | undefined
  private emittedWidths: number[] | undefined
  private emittedText: string | undefined
  private emittedColorMode: ColorMode | undefined
  private strokeProvenanceWork = 0

  constructor(width = 0, height = 0) {
    integer(width, 'width')
    integer(height, 'height')
    this.width = width
    this.height = height
  }

  get occupiedCells(): number {
    let count = 0
    for (const row of this.rows.values()) count += row.size
    return count
  }

  resize(width: number, height: number): void {
    integer(width, 'width')
    integer(height, 'height')
    this.width = Math.max(this.width, width)
    this.height = Math.max(this.height, height)
    this.emittedWidths = undefined
  }

  get(x: number, y: number): string {
    return this.rows.get(y)?.get(x)?.glyph ?? ' '
  }
  cell(x: number, y: number): TerminalCell | undefined {
    return this.rows.get(y)?.get(x)
  }
  hasOwner(id: string, kind?: TerminalOwner['kind']): boolean {
    return [...this.elements.values()].some(owner => owner.id === id && (kind === undefined || owner.kind === kind))
  }

  *entries(): IterableIterator<readonly [number, number, TerminalCell]> {
    for (const [y, row] of this.rows) for (const [x, cell] of row) yield [x, y, cell] as const
  }

  /** Snapshot of the occupied cells inside `bounds`. Within each row the
   * cells keep `entries()` order, so repainting them in sequence reorders a
   * row exactly as repainting the same cells from a whole-document snapshot. */
  entriesWithin(bounds: TerminalBounds): Array<readonly [number, number, TerminalCell]> {
    const cells: Array<readonly [number, number, TerminalCell]> = []
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
      const row = this.rows.get(y)
      if (row) for (const [x, cell] of row) if (x >= bounds.x && x < bounds.x + bounds.width) cells.push([x, y, cell] as const)
    }
    return cells
  }

  /** Attach identity at a family drawing boundary, retaining explicit text cells. */
  attribute(owners: TerminalOwner | readonly TerminalOwner[], paint: Omit<TerminalPaint, 'owner'> = {}): this {
    const canonical = this.owners(Array.isArray(owners) ? owners : [owners])
    const blocks = new Set<TextBlock>()
    for (const [, , cell] of this.entries()) {
      if (cell.textBlock) blocks.add(cell.textBlock)
      this.attributeStroke(cell, canonical)
      cell.owners = this.unionOwners(cell.owners, canonical)
      cell.owner ??= canonical[0]
      if (cell.kind !== 'text') {
        if (paint.role !== undefined) cell.role = paint.role
        if (paint.kind !== undefined) cell.kind = paint.kind
      }
      if (paint.color !== undefined) cell.color = paint.color
    }
    for (const block of this.retainedTextBlocks) blocks.add(block)
    for (const block of blocks) {
      this.attributeTextAllocations(block, canonical)
      if (block.emptyRows) for (const [row, previous] of block.emptyRows) block.emptyRows.set(row, this.unionOwners(previous, canonical))
    }
    return this
  }

  attributeWithin(owner: TerminalOwner, bounds: TerminalBounds, paint: Omit<TerminalPaint, 'owner'> = {}): this {
    for (const [label, value] of Object.entries({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })) integer(value, label)
    // Attribution changes identity, so its rectangle must admit every selected
    // grapheme completely before changing any cell or registering the owner.
    for (const [x, y, cell] of this.entries()) {
      if (x < bounds.x || x >= bounds.x + bounds.width || y < bounds.y || y >= bounds.y + bounds.height) continue
      if (cell.head < bounds.x || cell.head + cell.width > bounds.x + bounds.width) throw new RangeError('terminal attribution bounds must contain complete graphemes')
    }
    const attributed = this.remember(owner)!
    const canonical = this.owners([attributed])
    const blocks = new Set<TextBlock>()
    for (const [x, y, cell] of this.entries()) {
      if (x < bounds.x || x >= bounds.x + bounds.width || y < bounds.y || y >= bounds.y + bounds.height) continue
      this.attributeStroke(cell, canonical)
      cell.owners = this.unionOwners(cell.owners, canonical)
      if (cell.textBlock) blocks.add(cell.textBlock)
      if (paint.role !== undefined && cell.kind !== 'text') cell.role = paint.role
      if (paint.color !== undefined) cell.color = paint.color
    }
    for (const block of this.retainedTextBlocks) blocks.add(block)
    for (const block of blocks) {
      this.attributeTextAllocations(block, canonical, bounds)
      // A partial compartment cannot claim empty lines belonging to the rest
      // of its parent text occurrence.
      if (block.x < bounds.x || block.x + block.width > bounds.x + bounds.width || !block.emptyRows) continue
      for (const [row, previous] of block.emptyRows) if (row >= bounds.y && row < bounds.y + bounds.height) block.emptyRows.set(row, this.unionOwners(previous, canonical))
    }
    return this
  }

  private remember(owner: TerminalOwner | undefined): TerminalOwner | undefined {
    if (!owner) return undefined
    return this.admitOwners([owner])[0]
  }

  /** Snapshot and validate the complete import before registering any identity. */
  private admitOwners(values: Iterable<TerminalOwner>): TerminalOwner[] {
    const definitions: TerminalOwner[] = [],
      pending = new Map<string, TerminalOwner>(),
      snapshots = new WeakMap<TerminalOwner, TerminalOwner>()
    let imported = 0
    for (const supplied of values) {
      if (this.canonicalOwners.has(supplied)) {
        definitions.push(supplied)
        continue
      }
      const owner = snapshots.get(supplied) ?? snapshotOwner(supplied),
        key = ownerKey(owner)
      // Snapshot and validation each visit the definition and its members.
      imported += 1 + (owner.members?.length ?? 0)
      snapshots.set(supplied, owner)
      const previous = pending.get(key) ?? this.elements.get(key)
      if (previous) validateOwner(previous, owner)
      else pending.set(key, owner)
      definitions.push(previous ?? owner)
    }
    for (const [key, owner] of pending) {
      this.elements.set(key, owner)
      this.canonicalOwners.add(owner)
      this.ownerKeys.set(owner, key)
    }
    if (imported) observeWork('terminal-owner-import', imported)
    return definitions
  }

  /** Register a complete identity before allocating its primitives. */
  element(owner: TerminalOwner): TerminalElement {
    return this.remember(owner)! as TerminalElement
  }

  /** All paint and composition paths admit this complete interned set. */
  owners(values: Iterable<TerminalOwner>): TerminalOwnerSet {
    if (values === emptyOwners) return emptyOwners
    const cacheable = Array.isArray(values) && canonicalOwnerSets.has(values)
    const imported = cacheable ? this.importedOwners.get(values as readonly TerminalOwner[]) : undefined
    if (imported) return imported
    const byKey = new Map<string, TerminalOwner>()
    for (const owner of this.admitOwners(values)) byKey.set(this.ownerKeys.get(owner)!, owner)
    if (!byKey.size) return emptyOwners
    if (byKey.size === 1) {
      const set = this.singletonOwnerSet(byKey.values().next().value!)
      if (cacheable) this.importedOwners.set(values as readonly TerminalOwner[], set)
      return set
    }
    const keys = [...byKey.keys()].sort(compareCodePointStrings),
      key = JSON.stringify(keys)
    let set = this.ownerSets.get(key)
    if (!set) {
      set = Object.freeze(keys.map(key => byKey.get(key)!)) as TerminalOwnerSet
      canonicalOwnerSets.add(set)
      this.ownerSets.set(key, set)
      this.importedOwners.set(set, set)
    }
    if (cacheable) this.importedOwners.set(values as readonly TerminalOwner[], set)
    return set
  }

  private singletonOwnerSet(owner: TerminalOwner): TerminalOwnerSet {
    let set = this.singletonOwners.get(owner)
    if (!set) {
      set = Object.freeze([owner]) as TerminalOwnerSet
      canonicalOwnerSets.add(set)
      this.singletonOwners.set(owner, set)
      this.importedOwners.set(set, set)
    }
    return set
  }

  private paintOwners(paint: TerminalPaint): TerminalOwnerSet {
    const supplied = paint.owner ?? this.activeOwner
    if (!supplied) return paint.owners ? this.owners(paint.owners) : emptyOwners
    if (this.canonicalOwners.has(supplied)) {
      const primary = this.singletonOwnerSet(supplied)
      return paint.owners ? this.unionOwners(this.owners(paint.owners), primary) : primary
    }
    if (!paint.owners) return this.owners([supplied])
    return this.owners([...paint.owners, supplied])
  }

  private canonicalPaint(paint: TerminalPaint): TerminalPaint {
    paint = { ...paint }
    const primary = paint.owner ?? this.activeOwner
    const occluded = (paint as TerminalCell).occludedOwners
    if (!paint.owners && !occluded && (!primary || this.canonicalOwners.has(primary))) return primary === paint.owner ? paint : { ...paint, owner: primary }
    const supplied = [...(paint.owners ?? [])]
    const definitions = this.admitOwners([...supplied, ...(primary ? [primary] : []), ...(occluded ?? [])])
    const count = supplied.length + (primary ? 1 : 0)
    const owners = this.owners(definitions.slice(0, count))
    const retained = paint as TerminalCell
    return { ...paint, owner: primary ? definitions[supplied.length] : undefined, owners, ...(retained[strokeContributors] === paint.owners && owners.length === paint.owners?.length ? { [strokeContributors]: owners } : {}), ...(occluded ? { occludedOwners: this.owners(definitions.slice(count)) } : {}) }
  }

  private unionOwners(left: readonly TerminalOwner[], right: readonly TerminalOwner[]): TerminalOwnerSet {
    const a = this.owners(left),
      b = this.owners(right)
    if (!a.length || a === b) return b
    if (!b.length) return a
    let unions = this.ownerUnions.get(a)
    const cached = unions?.get(b) ?? this.ownerUnions.get(b)?.get(a)
    if (cached) return cached
    const combined = a.every(owner => b.includes(owner)) ? b : b.every(owner => a.includes(owner)) ? a : this.owners([...a, ...b])
    if (!unions) {
      unions = new WeakMap()
      this.ownerUnions.set(a, unions)
    }
    unions.set(b, combined)
    return combined
  }

  scope<T>(owner: TerminalOwner, draw: () => T): T {
    const previous = this.activeOwner
    const previousBlock = this.activeTextBlock
    this.activeOwner = this.remember(owner)
    this.activeTextBlock = undefined
    try {
      return draw()
    } finally {
      this.activeOwner = previous
      this.activeTextBlock = previousBlock
    }
  }

  region(owner: TerminalOwner, bounds: TerminalBounds): void {
    for (const [label, value] of Object.entries({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height })) integer(value, label)
    if (bounds.width === 0 || bounds.height === 0) return
    const remembered = this.remember(owner)!,
      key = ownerKey(remembered)
    this.resize(bounds.x + bounds.width, bounds.y + bounds.height)
    const previous = this.declared.get(key)
    this.declared.set(key, previous ? union(previous, bounds) : { ...bounds })
  }

  port(owner: TerminalOwner, port: TerminalPort): void {
    port = snapshotTerminalPort(port)
    integer(port.x, 'port x')
    integer(port.y, 'port y')
    integer(port.x + 1, 'width')
    integer(port.y + 1, 'height')
    const key = ownerKey(this.remember(owner)!)
    const ports = this.ports.get(key) ?? []
    if (!ports.some(existing => existing.end === port.end && existing.nodeId === port.nodeId)) ports.push(port)
    this.ports.set(key, ports)
    this.resize(port.x + 1, port.y + 1)
  }

  /** Allocate from the native family model, never infer intent from ink. */
  expectMarkers(owner: TerminalOwner, end: TerminalPort['end'], markers: readonly TerminalMarker[], offset = 0): void {
    const port = this.ports.get(ownerKey(this.remember(owner)!))?.find(port => port.end === end)
    if (!port || port.markers) throw new TypeError(`Terminal endpoint ${owner.id}/${end} must have one allocated marker contract`)
    port.markers = Object.freeze(markers.map(marker => Object.freeze({ ...marker, direction: marker.direction ?? 'R' })))
    port.markerOffset = offset
  }

  projectMarkers(owner: TerminalOwner, feature: string): void {
    for (const port of this.ports.get(ownerKey(this.remember(owner)!)) ?? []) port.markerProjection = feature
  }

  /** Inspect final visible cells after all routing, overlays and reflections.
   * Node decorations and non-geometric family projections are not connectors. */
  assertMarkers(visit: () => void = () => {}): void {
    let contracted = false
    let neededTextOwners: Set<string> | undefined
    for (const [key, ports] of this.ports)
      for (const port of ports) {
        visit()
        contracted ||= port.markers !== undefined
        if (port.markers && port.markerProjection) (neededTextOwners ??= new Set()).add(key)
      }
    if (!contracted) return
    const visibleTextOwners = neededTextOwners ? new Set<string>() : undefined
    let projectionFeatures: Set<string> | undefined
    const frames = new Map<string, { kind: TerminalOwner['kind']; bounds: TerminalBounds }>()
    const typedFrames = new Map<string, TerminalBounds>()
    const includeFrame = (owner: TerminalOwner, bounds: TerminalBounds, declared = false) => {
      if (!['node', 'group', 'cluster', 'subgraph'].includes(owner.kind ?? 'node')) return
      const typedKey = ownerKey(owner),
        typedPrevious = typedFrames.get(typedKey)
      typedFrames.set(typedKey, !declared && typedPrevious ? union(typedPrevious, bounds) : bounds)
      const previous = frames.get(owner.id)
      if (previous?.kind === 'node' && owner.kind !== 'node') return
      frames.set(owner.id, { kind: owner.kind, bounds: !declared && previous && previous.kind === owner.kind ? union(previous.bounds, bounds) : bounds })
    }
    // Owned link summaries and labels are not surfaces. Explicit native card
    // allocation wins over inferred ink bounds, which may include annotations.
    for (const [x, y, cell] of this.entries()) {
      visit()
      if (neededTextOwners?.size && cell.kind === 'text' && cell.glyph.trim()) {
        for (const owner of cell.owners) {
          visit()
          const key = this.ownerKeys.get(owner) ?? ownerKey(owner)
          if (neededTextOwners.delete(key)) visibleTextOwners!.add(key)
          if (!neededTextOwners.size) break
        }
      }
      if (cell.kind !== 'text')
        for (const owner of cell.owners) {
          visit()
          includeFrame(owner, { x, y, width: cell.width, height: 1 })
        }
    }
    for (const [key, bounds] of this.declared) {
      visit()
      includeFrame(this.elements.get(key)!, bounds, true)
    }
    const expected = new Map<string, Set<string>>()
    for (const [key, ports] of this.ports) {
      const owner = this.elements.get(key)!
      const owns = (cell: TerminalCell | undefined) =>
        cell?.owners.some(candidate => {
          visit()
          return ownerKey(candidate) === key
        })
      for (const port of ports) {
        visit()
        if (!port.markers) continue
        const fail = () => {
          throw new Error(`Terminal marker contract failed: ${owner.id}/${port.end} at ${port.x},${port.y}`)
        }
        if (!port.side) fail()
        const dx = port.side === 'R' ? 1 : port.side === 'L' ? -1 : 0
        const dy = port.side === 'B' ? 1 : port.side === 'T' ? -1 : 0
        const sites = expected.get(key) ?? new Set<string>()
        expected.set(key, sites)
        if (port.markerProjection) {
          if (!projectionFeatures) {
            projectionFeatures = new Set()
            for (const diagnostic of this.diagnostics) {
              visit()
              if (diagnostic.code === 'TERMINAL_FAMILY_PROJECTION') projectionFeatures.add(diagnostic.feature)
            }
          }
          if (!projectionFeatures.has(port.markerProjection) || !visibleTextOwners!.has(key)) fail()
          continue
        }
        if (port.markers.length && port.surface !== 'lifeline') {
          const bounds = port.boundary ? typedFrames.get(ownerKey(port.boundary)) : frames.get(port.nodeId)?.bounds
          if (!bounds) fail()
          const frame = bounds!
          const distance = dx ? (dx > 0 ? port.x - (frame.x + frame.width - 1) : frame.x - port.x) : dy > 0 ? port.y - (frame.y + frame.height - 1) : frame.y - port.y
          const along = dx ? port.y - frame.y : port.x - frame.x
          if (distance < 0 || distance > 1 || along < 0 || along >= (dx ? frame.height : frame.width)) fail()
        }
        for (const [index, marker] of port.markers.entries()) {
          visit()
          const offset = (port.markerOffset ?? 0) + index
          const x = port.x + dx * offset,
            y = port.y + dy * offset,
            cell = this.cell(x, y)
          sites.add(`${x},${y}`)
          if (x >= (this.lineWidths?.[y] ?? this.width) || !owns(cell) || cell?.kind !== 'marker' || !cell.marker || cell.marker.shape !== marker.shape || (cell.marker.direction ?? 'R') !== (marker.direction ?? 'R') || !!cell.marker.ascii !== !!marker.ascii || cell.glyph !== markerGlyph(marker)) fail()
          if (['arrow', 'triangle', 'open-arrow', 'half-top', 'half-bottom', 'stick-top', 'stick-bottom'].includes(marker.shape) && marker.direction !== ({ T: 'B', B: 'T', L: 'R', R: 'L' } as const)[port.side!]) fail()
        }
      }
    }
    if (!expected.size) return
    for (const [x, y, cell] of this.entries()) {
      visit()
      if (cell.kind !== 'marker') continue
      for (const owner of cell.owners) {
        visit()
        const sites = expected.get(ownerKey(owner))
        if (sites && !sites.has(`${x},${y}`)) throw new Error(`Unexpected terminal marker: ${owner.id} at ${x},${y}`)
      }
    }
  }

  report(diagnostic: TerminalProjectionDiagnostic): void {
    this.addDiagnostic(diagnostic, this.diagnosticKey(diagnostic))
  }

  private diagnosticKey(diagnostic: TerminalProjectionDiagnostic): string {
    return this.diagnosticIdentities.get(diagnostic) ?? JSON.stringify(['feature', diagnostic.code, diagnostic.feature])
  }

  private addDiagnostic(diagnostic: TerminalProjectionDiagnostic, key: string): void {
    if (this.diagnosticKeys.has(key)) return
    this.diagnosticKeys.add(key)
    this.diagnosticIdentities.set(diagnostic, key)
    this.diagnostics.push(diagnostic)
  }

  private warn(code: TerminalCompositionDiagnostic['code'], owners: readonly TerminalOwner[], x: number, y: number): void {
    const canonical = this.owners(owners)
    let cached = this.warningFeatures.get(canonical)
    if (!cached) {
      cached = {
        feature: owners
          .map(owner => `${owner.kind ?? 'node'}:${owner.id}`)
          .sort(compareCodePointStrings)
          .join('|'),
        keys: {},
      }
      this.warningFeatures.set(canonical, cached)
    }
    const feature = cached.feature
    const key = (cached.keys[code] ??= JSON.stringify(['owners', code, canonical.map(owner => [owner.kind ?? 'node', owner.id])]))
    if (this.diagnosticKeys.has(key)) return
    const description = code === 'TERMINAL_TEXT_COLLISION' ? 'Text footprints overlap' : code === 'TERMINAL_ROUTE_OVERLAP' ? 'Unrelated route runs overlap' : 'Incompatible occupied geometry overlaps'
    this.addDiagnostic({ code, feature, cell: { column: x, row: y }, message: `${description}; owners: ${owners.map(owner => owner.id).join(', ')}.` }, key)
  }

  private reserveStrokeProvenance(count: number): void {
    const next = this.strokeProvenanceWork + count
    if (!Number.isSafeInteger(next) || next > TERMINAL_CERTIFICATION_LIMITS.maxOperations) throw new RangeError('Terminal stroke provenance exceeds certification ceiling')
    this.strokeProvenanceWork = next
  }

  private contribution(cell: TerminalCell | undefined, owner: TerminalOwner, fallback: number): number {
    if (!cell || cell[strokeContributors] === undefined) return fallback
    // A copied/mutated owner list cannot acquire directions from existing ink.
    if (cell[strokeContributors] !== cell.owners) return 0
    const masks = cell[strokeContributions]
    if (cell.owners.length === 1) return ownerKey(cell.owners[0]!) === ownerKey(owner) ? (typeof masks === 'number' ? masks : (masks?.[0] ?? 0)) : 0
    for (let index = 0; index < cell.owners.length; index++) {
      this.reserveStrokeProvenance(1)
      if (ownerKey(cell.owners[index]!) === ownerKey(owner)) return typeof masks === 'number' ? masks : (masks?.[index] ?? 0)
    }
    return 0
  }

  private strokeSnapshot(owners: TerminalOwnerSet, incoming: TerminalCell, incomingOwners: TerminalOwnerSet, mask: number, old?: TerminalCell): number | readonly number[] {
    if (!owners.length) return (old?.stroke?.mask ?? (old ? (strokePorts[old.glyph] ?? styledPorts[old.glyph] ?? asciiPorts[old.glyph] ?? 0) : 0)) | mask
    if (incoming[strokeContributors] === undefined && incoming.head !== undefined && incoming.width !== undefined) return 0 // imported cells must retain original provenance
    if (!old && incoming[strokeContributors] === undefined) return mask
    if (!old && incoming[strokeContributors] === incoming.owners && !incoming.owners.length) return incoming[strokeContributions] ?? 0
    if (!old && owners.length <= 1 && incomingOwners.length === owners.length) return owners.length ? this.contribution(incoming, owners[0]!, mask) : (incoming[strokeContributions] ?? mask)
    if (!old && incoming[strokeContributors] === incoming.owners && incomingOwners.length === owners.length) {
      let same = true
      for (let index = 0; index < owners.length; index++) {
        this.reserveStrokeProvenance(1)
        if (ownerKey(owners[index]!) !== ownerKey(incomingOwners[index]!)) same = false
      }
      if (same) return incoming[strokeContributions] ?? 0
    }
    // Same singleton paint is the common path: no extra array or scan.
    if (owners.length === 1 && (!old || old.owners === owners) && incomingOwners === owners) {
      return this.contribution(old, owners[0]!, 0) | this.contribution(incoming, owners[0]!, mask)
    }
    // Every owner of two equally directed uniform strokes retains that same
    // mask. Keep the scalar proof instead of expanding each shared trunk cell.
    if (old && old[strokeContributors] === old.owners && typeof old[strokeContributions] === 'number') {
      this.reserveStrokeProvenance(1)
      const next = incoming[strokeContributors] === undefined ? mask : incoming[strokeContributors] === incoming.owners ? incoming[strokeContributions] : undefined
      if (next === old[strokeContributions]) return next
    }
    this.reserveStrokeProvenance(owners.length + 1) // retained array slots/header BEFORE allocation
    const masks: number[] = []
    // Admitted owner sets share canonical key order. Walk each source once,
    // retaining its own directions rather than rescanning it for every owner.
    const previousOwners = old && old[strokeContributors] === old.owners ? old.owners : emptyOwners
    const nextOwners = incoming[strokeContributors] === undefined || incoming[strokeContributors] === incoming.owners ? incomingOwners : emptyOwners
    const previousMasks = old?.[strokeContributions],
      nextMasks = incoming[strokeContributions]
    let previousIndex = 0,
      nextIndex = 0
    for (const owner of owners) {
      this.reserveStrokeProvenance(1)
      const key = ownerKey(owner)
      let previous = 0,
        next = 0
      if (previousIndex < previousOwners.length) {
        this.reserveStrokeProvenance(1)
        if (ownerKey(previousOwners[previousIndex]!) === key) {
          previous = typeof previousMasks === 'number' ? previousMasks : (previousMasks?.[previousIndex] ?? 0)
          previousIndex++
        }
      }
      if (nextIndex < nextOwners.length) {
        this.reserveStrokeProvenance(1)
        if (ownerKey(nextOwners[nextIndex]!) === key) {
          next = incoming[strokeContributors] === undefined ? mask : typeof nextMasks === 'number' ? nextMasks : (nextMasks?.[nextIndex] ?? 0)
          nextIndex++
        }
      }
      masks.push(previous | next)
    }
    return Object.freeze(masks)
  }

  private attributeStroke(cell: TerminalCell, canonical: TerminalOwnerSet): void {
    if (cell.kind !== 'stroke') return
    const owners = this.unionOwners(cell.owners, canonical)
    if (owners === cell.owners) return
    const mask = cell.stroke?.mask ?? strokePorts[cell.glyph] ?? styledPorts[cell.glyph] ?? asciiPorts[cell.glyph] ?? 0
    // Attribution explicitly claims unowned ink. It cannot split a prior crossing.
    const contributions = cell[strokeContributions]
    const uniform =
      typeof contributions === 'number'
        ? contributions
        : contributions?.every(value => {
              this.reserveStrokeProvenance(1)
              return value === mask
            })
          ? mask
          : undefined
    if (
      canonical.some(owner => {
        this.reserveStrokeProvenance(1)
        return (
          owner.kind === 'edge' &&
          !cell.owners.some(previous => {
            this.reserveStrokeProvenance(1)
            return previous === owner
          })
        )
      }) &&
      uniform === undefined
    )
      throw new TypeError('Cannot attribute ambiguous merged stroke to a new edge')
    if (!cell.owners.length) {
      cell[strokeContributors] = owners
      cell[strokeContributions] = mask
      return
    }
    this.reserveStrokeProvenance(owners.length + 1)
    const masks = owners.map(owner => {
      this.reserveStrokeProvenance(1)
      return cell.owners.some(previous => {
        this.reserveStrokeProvenance(1)
        return previous === owner
      })
        ? this.contribution(cell, owner, 0)
        : owner.kind === 'edge'
          ? uniform!
          : 0
    })
    cell[strokeContributors] = owners
    cell[strokeContributions] = Object.freeze(masks)
  }

  private retire(x: number, y: number): void {
    const row = this.rows.get(y),
      old = row?.get(x)
    if (!row || !old) return
    for (let cell = old.head; cell < old.head + old.width; cell++) row.delete(cell)
  }

  put(x: number, y: number, glyph: string, paint: TerminalPaint = {}): void {
    integer(x, 'x')
    integer(y, 'y')
    if (!glyph) return
    if (glyph === WIDE_CHAR_CONTINUATION) return
    glyph = sanitizeTerminalText(glyph, true)
    if (glyph.length !== 1 || charVisualWidth(glyph) !== 1) {
      this.text(x, y, glyph, paint)
      return
    }
    paint = this.canonicalPaint(paint)
    const owner = paint.owner
    const kind = paint.kind ?? 'stroke'
    if (glyph === ' ' && kind === 'stroke' && !owner) {
      this.resize(x + 1, y + 1)
      return
    }
    this.place(x, y, glyph, 1, { ...paint, owner, kind }, undefined)
  }

  private admit(x: number, y: number, glyph: string, width: number, paint: TerminalPaint, incoming: TerminalOwnerSet, strict = false): boolean {
    // Both sets contain this document's canonical immutable definitions.
    const related = (a: TerminalOwner, b: TerminalOwner, geometry = true) => a === b || (geometry && geometryRelated(a, b))
    const incompatible = (previous: readonly TerminalOwner[], bundles = true) => previous.length > 0 && incoming.length > 0 && (previous.some(owner => !incoming.some(next => related(owner, next, bundles))) || incoming.some(next => !previous.some(owner => related(owner, next, bundles))))
    // Check every affected cell and every owner before retiring any old grapheme.
    for (let offset = 0; offset < width; offset++) {
      const covered = this.cell(x + offset, y)
      if (!covered) continue
      const previous = covered.head === x + offset ? covered : this.cell(covered.head, y)!
      if (strict && (previous.kind === 'marker' || previous.kind === 'surface' || previous.kind === 'mark') && (!previous.owners.length || !incoming.length)) {
        this.warn('TERMINAL_GEOMETRY_COLLISION', this.unionOwners(previous.owners, incoming), x + offset, y)
        return false
      }
      if (previous.kind === 'text') {
        const unrelated = incompatible(previous.owners, false)
        if (unrelated) this.warn('TERMINAL_TEXT_COLLISION', this.unionOwners(previous.owners, incoming), x + offset, y)
        if (unrelated || paint.kind !== 'text') return false
        continue
      }
      const unrelated = incompatible(previous.owners)
      if (previous.kind === 'surface' && unrelated) {
        this.warn('TERMINAL_GEOMETRY_COLLISION', this.unionOwners(previous.owners, incoming), x + offset, y)
        return false
      }
      if (previous.kind === 'marker') {
        const coincident = paint.kind === 'marker' && previous.head === x && previous.width === width && previous.glyph === glyph
        if (!coincident && (unrelated || (paint.kind !== 'text' && paint.kind !== 'surface'))) {
          if (unrelated) this.warn('TERMINAL_GEOMETRY_COLLISION', this.unionOwners(previous.owners, incoming), x + offset, y)
          return false
        }
      }
      if (previous.kind === 'mark' && paint.kind !== 'stroke' && unrelated) {
        this.warn('TERMINAL_GEOMETRY_COLLISION', this.unionOwners(previous.owners, incoming), x + offset, y)
        return false
      }
      if (previous.kind === 'stroke' && paint.kind === 'text' && unrelated) {
        this.warn('TERMINAL_GEOMETRY_COLLISION', this.unionOwners(previous.owners, incoming), x + offset, y)
        if (strict) return false
      }
    }
    return true
  }

  private place(x: number, y: number, glyph: string, width: number, paint: TerminalPaint, block: TextBlock | undefined): boolean {
    const old = this.cell(x, y),
      incoming = this.paintOwners(paint)
    if (!this.admit(x, y, glyph, width, paint, incoming)) return false
    if (!block && paint.kind === 'surface' && old?.kind === 'surface' && old.textBlock && x >= old.textBlock.x && x + width <= old.textBlock.x + old.textBlock.width && this.compatibleTextSurface(old.owners, incoming)) block = old.textBlock
    if (old?.kind === 'mark' && paint.kind === 'stroke') {
      old.occludedOwners = this.unionOwners(old.occludedOwners ?? emptyOwners, incoming)
      return true
    }
    let owners = incoming
    const originalStroke = paint.kind === 'stroke' ? (paint as TerminalCell) : undefined
    const incomingMask = paint.kind === 'stroke' ? (paint.stroke?.mask ?? strokePorts[glyph] ?? styledPorts[glyph] ?? asciiPorts[glyph] ?? 0) : 0
    const importedOcclusion = (paint as TerminalCell).occludedOwners
    let occludedOwners = importedOcclusion ? this.owners(importedOcclusion) : undefined
    if (old?.kind === 'marker' && paint.kind === 'marker') owners = this.unionOwners(old.owners, incoming)
    if (paint.kind === 'mark' && old?.kind === 'stroke') occludedOwners = this.unionOwners(this.unionOwners(old.owners, old.occludedOwners ?? emptyOwners), occludedOwners ?? emptyOwners)
    if (old?.kind === 'stroke' && paint.kind === 'stroke') {
      const a = old.stroke?.mask ?? strokePorts[old.glyph] ?? styledPorts[old.glyph] ?? asciiPorts[old.glyph]
      const b = paint.stroke?.mask ?? strokePorts[glyph] ?? styledPorts[glyph] ?? asciiPorts[glyph]
      if (paint.stroke || old.stroke) {
        const stroke = { ...(paint.stroke ?? old.stroke!), mask: (a ?? 0) | (b ?? 0) }
        paint = { ...paint, stroke }
        glyph = strokeGlyph(stroke)
      } else if (a && b && a !== b) glyph = asciiPorts[old.glyph] === undefined && asciiPorts[glyph] === undefined ? (portGlyph.get(a | b) ?? glyph) : '+'
      owners = this.unionOwners(old.owners, incoming)
      if (a !== undefined && a === b && old.owners.some(previous => incoming.some(next => previous.kind === 'edge' && next.kind === 'edge' && previous.id !== next.id && !(previous.bundle && previous.bundle === next.bundle)))) this.warn('TERMINAL_ROUTE_OVERLAP', owners, x, y)
    }
    const contributions = originalStroke ? this.strokeSnapshot(owners, originalStroke, (originalStroke.owners ?? incoming) as TerminalOwnerSet, incomingMask, old?.kind === 'stroke' ? old : undefined) : undefined
    for (let offset = 0; offset < width; offset++) this.retire(x + offset, y)
    this.resize(x + width, y + 1)
    let row = this.rows.get(y)
    if (!row) {
      row = new Map()
      this.rows.set(y, row)
    }
    // Store the cell contract, not call-only stroke settings or an imported
    // cell's old coordinates. In particular, ascii/style/rounded already live
    // on the immutable stroke and need not occupy every painted cell as well.
    const cell: TerminalCell = { glyph, owners, head: x, width }
    if (contributions !== undefined) {
      cell[strokeContributors] = owners
      cell[strokeContributions] = contributions
    }
    if (paint.owner !== undefined) cell.owner = paint.owner
    if (paint.role !== undefined) cell.role = paint.role
    if (paint.color !== undefined) cell.color = paint.color
    if (paint.kind !== undefined) cell.kind = paint.kind
    if (paint.textGroup !== undefined) cell.textGroup = paint.textGroup
    if (paint.stroke !== undefined) cell.stroke = paint.stroke
    if (paint.marker !== undefined) cell.marker = paint.marker
    if (paint.numericMark !== undefined) cell.numericMark = paint.numericMark
    if (block) cell.textBlock = block
    if (occludedOwners?.length) cell.occludedOwners = occludedOwners
    row.set(x, cell)
    for (let offset = 1; offset < width; offset++) row.set(x + offset, { ...cell, glyph: WIDE_CHAR_CONTINUATION })
    if (this.lineWidths?.[y] !== undefined) this.lineWidths[y] = Math.max(this.lineWidths[y]!, x + width)
    this.metrics.writes += width
    return true
  }

  stroke(x: number, y: number, mask: number, paint: TerminalPaint & Omit<TerminalStroke, 'mask'> = {}): void {
    if (!Number.isInteger(mask) || mask < 1 || mask > 15) throw new RangeError('stroke mask must contain terminal cardinal ports')
    const stroke = Object.freeze({ mask, ascii: paint.ascii, style: paint.style, rounded: paint.rounded })
    this.put(x, y, strokeGlyph(stroke), { ...paint, kind: 'stroke', stroke })
  }

  /** Validate a complete stroke batch before changing any occupied cell. */
  strokeBatch(cells: readonly { x: number; y: number; mask: number; role?: CharRole }[], paint: TerminalPaint & Omit<TerminalStroke, 'mask'> = {}): boolean {
    const settings = { ...paint }
    const strokes = cells.map(({ x, y, mask, role }) => {
      integer(x, 'x')
      integer(y, 'y')
      integer(x + 1, 'width')
      integer(y + 1, 'height')
      if (!Number.isInteger(mask) || mask < 1 || mask > 15) throw new RangeError('stroke mask must contain terminal cardinal ports')
      const stroke = Object.freeze({ mask, ascii: settings.ascii, style: settings.style, rounded: settings.rounded })
      return { x, y, glyph: strokeGlyph(stroke), stroke, role }
    })
    const shared = this.canonicalPaint({ ...settings, kind: 'stroke' })
    const prepared = strokes.map(cell => ({ ...cell, paint: { ...shared, ...(cell.role ? { role: cell.role } : {}), stroke: cell.stroke } }))
    if (prepared.some(cell => !this.admit(cell.x, cell.y, cell.glyph, 1, cell.paint, this.paintOwners(cell.paint), true))) return false
    for (const cell of prepared) this.place(cell.x, cell.y, cell.glyph, 1, cell.paint, undefined)
    return true
  }

  marker(x: number, y: number, marker: TerminalMarker, paint: TerminalPaint = {}): void {
    const semantic = Object.freeze({ ...marker, direction: marker.direction ?? 'R' })
    this.put(x, y, markerGlyph(semantic), { ...paint, kind: 'marker', marker: semantic })
  }

  mark(x: number, y: number, glyph: string, paint: TerminalPaint = {}): void {
    this.put(x, y, glyph, { ...paint, kind: 'mark' })
  }

  numericMark(x: number, y: number, mark: TerminalNumericMark, paint: TerminalPaint = {}): void {
    if (mark.coverage !== 1 && mark.coverage !== 2 && mark.coverage !== 3) throw new RangeError('numeric mark coverage must contain one or both half cells')
    const semantic = Object.freeze({ ...mark })
    this.mark(x, y, numericMarkGlyph(semantic), { ...paint, numericMark: semantic })
  }

  private compatibleTextSurface(previous: TerminalOwnerSet, incoming: TerminalOwnerSet): boolean {
    return previous.length > 0 && incoming.length > 0 && previous.every(owner => incoming.some(next => geometryRelated(owner, next))) && incoming.every(next => previous.some(owner => geometryRelated(owner, next)))
  }

  private bindTextSurface(block: TextBlock, incoming: TerminalOwnerSet, previous?: TerminalBounds): void {
    const bind = (x: number, y: number, width: number, height: number): void => {
      for (let row = y; row < y + height; row++)
        for (let column = x; column < x + width; column++) {
          const cell = this.cell(column, row)
          if (cell?.kind !== 'surface' || cell.head < block.x || cell.head + cell.width > block.x + block.width) continue
          if (this.compatibleTextSurface(cell.owners, incoming)) cell.textBlock = block
        }
    }
    if (!previous) bind(block.x, block.y, block.width, block.height)
    else {
      bind(block.x, block.y, block.width, previous.y - block.y)
      bind(block.x, previous.y + previous.height, block.width, block.y + block.height - previous.y - previous.height)
      bind(block.x, previous.y, previous.x - block.x, previous.height)
      bind(previous.x + previous.width, previous.y, block.x + block.width - previous.x - previous.width, previous.height)
    }
  }

  private recordEmptyRows(block: TextBlock, y: number, rows: readonly number[], owners: TerminalOwnerSet): void {
    if (!rows.length) return
    block.emptyRows ??= new Map()
    for (const row of rows) block.emptyRows.set(y + row, this.unionOwners(block.emptyRows.get(y + row) ?? emptyOwners, owners))
  }

  private attributeTextAllocations(block: TextBlock, owners: TerminalOwnerSet, bounds?: TerminalBounds): void {
    if (!block.allocations) return
    block.allocations = block.allocations.map(allocation => {
      if (!bounds || (allocation.x >= bounds.x && allocation.y >= bounds.y && allocation.x + allocation.text.width <= bounds.x + bounds.width && allocation.y + allocation.text.height <= bounds.y + bounds.height)) return { ...allocation, owners: this.unionOwners(allocation.owners, owners) }
      if (allocation.x + allocation.text.width <= bounds.x || allocation.x >= bounds.x + bounds.width || allocation.y + allocation.text.height <= bounds.y || allocation.y >= bounds.y + bounds.height) return allocation
      return { ...allocation, attributions: [...(allocation.attributions ?? []), { bounds: { ...bounds }, owners }] }
    })
  }

  private movedTextBlock(block: TextBlock, x: number, y: number): TextBlock {
    const dx = x - block.x,
      dy = y - block.y
    return {
      ...block,
      x,
      y,
      ...(block.allocations
        ? {
            allocations: block.allocations.map(allocation => ({
              ...allocation,
              x: allocation.x + dx,
              y: allocation.y + dy,
              owners: this.owners(allocation.owners),
              ...(allocation.attributions ? { attributions: allocation.attributions.map(attribution => ({ owners: this.owners(attribution.owners), bounds: { ...attribution.bounds, x: attribution.bounds.x + dx, y: attribution.bounds.y + dy } })) } : {}),
            })),
          }
        : {}),
      ...(block.emptyRows ? { emptyRows: new Map([...block.emptyRows].map(([row, owners]) => [row + y - block.y, this.owners(owners)])) } : {}),
    }
  }

  /** Complete immutable measured text is admitted as one allocation. */
  textBlock(x: number, y: number, value: string | readonly string[] | MeasuredTerminalText, paint: TerminalPaint = {}): Readonly<AllocatedTerminalText> | undefined {
    integer(x, 'x')
    integer(y, 'y')
    const text = typeof value === 'object' && measuredBrand in value ? value : measuredText(value as string | readonly string[])
    paint = this.canonicalPaint(paint)
    const owner = paint.owner,
      incoming = this.paintOwners(paint)
    const ink = { ...paint, owner, kind: 'text' as const, role: paint.role === undefined ? ('text' as const) : paint.role }
    for (let row = 0; row < text.height; row++) for (let column = 0; column < text.width; column++) if (!this.admit(x + column, y + row, ' ', 1, ink, incoming, true)) return undefined
    const bounds = { x, y, width: text.width, height: text.height }
    const groupKey = textGroupKey(owner, paint.textGroup)
    const scoped = owner !== undefined && owner === this.activeOwner
    let block = groupKey === undefined ? (scoped ? this.activeTextBlock : undefined) : this.textGroups.get(groupKey)
    const previous = block ? { ...block } : undefined
    if (block) Object.assign(block, union(block, bounds))
    else {
      block = { ...bounds }
      if (scoped) this.activeTextBlock = block
      if (groupKey !== undefined) this.textGroups.set(groupKey, block)
    }
    this.retainedTextBlocks.add(block)
    ;(block.allocations ??= []).push({ x, y, text, owners: incoming })
    this.bindTextSurface(block, incoming, previous)
    const surface = { ...paint, owner, kind: 'surface' as const }
    for (let row = 0; row < text.height; row++) {
      let end = 0
      for (const cluster of text.lines[row]!) {
        this.place(x + cluster.x, y + row, cluster.glyph, cluster.width, ink, block)
        end = cluster.x + cluster.width
      }
      for (let column = end; column < text.width; column++) this.place(x + column, y + row, ' ', 1, surface, block)
    }
    this.recordEmptyRows(block, y, text.emptyRows, incoming)
    this.resize(x + text.width, y + text.height)
    return Object.freeze({ ...bounds, text })
  }

  text(x: number, y: number, text: string, paint: TerminalPaint = {}): TerminalBounds {
    integer(x, 'x')
    integer(y, 'y')
    paint = this.canonicalPaint(paint)
    const owner = paint.owner
    const measured = measuredText(text)
    const bounds = { x, y, width: measured.width, height: measured.height }
    const kind = paint.kind ?? 'text'
    const scoped = kind === 'text' && owner !== undefined && owner === this.activeOwner
    const groupKey = textGroupKey(owner, paint.textGroup)
    let block = groupKey === undefined ? (scoped ? this.activeTextBlock : undefined) : this.textGroups.get(groupKey)
    const previous = block ? { ...block } : undefined
    if (block) Object.assign(block, union(block, bounds))
    else {
      block = { ...bounds }
      if (scoped) this.activeTextBlock = block
      if (groupKey !== undefined) this.textGroups.set(groupKey, block)
    }
    const incoming = this.paintOwners({ ...paint, owner })
    if (kind === 'text') {
      this.retainedTextBlocks.add(block)
      ;(block.allocations ??= []).push({ x, y, text: measured, owners: incoming })
      this.bindTextSurface(block, incoming, previous)
    }
    const ink = { ...paint, owner, role: paint.role === undefined ? ('text' as const) : paint.role, kind }
    let accepted = false
    measured.lines.forEach((line, offsetY) => {
      for (const cluster of line) accepted = this.place(x + cluster.x, y + offsetY, cluster.glyph, cluster.width, ink, kind === 'text' ? block : undefined) || accepted
    })
    if (kind === 'text' && (accepted || measured.lines.every(line => line.length === 0))) this.recordEmptyRows(block, y, measured.emptyRows, incoming)
    this.resize(x + bounds.width, y + bounds.height)
    return bounds
  }

  fill(x: number, y: number, width: number, height: number, paint: TerminalPaint = {}): void {
    for (const [label, value] of Object.entries({ x, y, width, height })) integer(value, label)
    const surface = { ...this.canonicalPaint(paint), kind: 'surface' as const }
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) this.place(col, row, ' ', 1, surface, undefined)
  }

  line(runs: readonly TerminalRun[] = [], defaults?: TerminalPaint): void {
    defaults = defaults ? { ...defaults } : undefined
    const paints = runs.map(run => {
      run = { ...run }
      const owner = run.owner ?? defaults?.owner
      return defaults ? { ...defaults, ...run, owner, textGroup: run.textGroup ?? defaults.textGroup, kind: run.kind ?? defaults.kind ?? (run.role === 'text' ? 'text' : run.role == null ? 'surface' : 'stroke') } : run
    })
    const plans = paints.map(paint => ({ paint, owner: paint.owner ?? this.activeOwner, owners: [...(paint.owners ?? [])] }))
    const definitions = this.admitOwners(plans.flatMap(plan => [...plan.owners, ...(plan.owner ? [plan.owner] : [])]))
    let cursor = 0
    const prepared = plans.map(({ paint, owner, owners }) => {
      const count = owners.length + (owner ? 1 : 0),
        imported = definitions.slice(cursor, cursor + count)
      const primary = owner ? imported[owners.length] : undefined
      cursor += count
      return { ...paint, owner: primary, owners: this.owners(imported), ...(defaults ? { textGroup: paint.textGroup ?? primary?.id } : {}) }
    })
    const y = this.height
    this.lineWidths ??= Array.from({ length: this.height }, () => this.width)
    let x = 0
    for (const [index, run] of paints.entries()) {
      const paint = prepared[index]!
      this.text(x, y, run.text, paint)
      x += visualWidth(run.text)
    }
    this.resize(x, y + 1)
    this.lineWidths[y] = x
  }

  hasTerminalPathWitnessState(): boolean {
    return pathWitnessStates.has(this)
  }

  /** Monotone deferred certification work. The ordinary no-witness path creates no state. */
  reserveTerminalPathWitnessWork(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid terminal path witness reservation')
    const current = pathWitnessStates.get(this),
      next = (current?.work ?? 3) + count
    if (!Number.isSafeInteger(next) || next > TERMINAL_CERTIFICATION_LIMITS.maxOperations) throw new RangeError('Terminal path witness reservation exceeds certification ceiling')
    if (current) current.work = next
    else pathWitnessStates.set(this, { work: next, witnesses: new Map() }) // three reserved header records
  }

  /** Only a successful canonical stroke admission can supply this opaque token. */
  registerTerminalPathWitness(owner: TerminalOwner, token: unknown, dx = 0, dy = 0): void {
    this.reserveTerminalPathWitnessWork(1) // inspect admission authority/identity
    const admission = terminalPathAdmission(token)
    if (!admission || owner.kind !== 'edge' || owner.route !== 'connected' || owner.id !== admission.owner.id || owner.from !== admission.owner.from || owner.to !== admission.owner.to) return
    const key = ownerKey(owner),
      canonical = this.elements.get(key)
    if (!canonical || canonical.route !== 'connected' || canonical.from !== owner.from || canonical.to !== owner.to) return
    const state = pathWitnessStates.get(this)!
    if (state.witnesses.has(key)) {
      this.reserveTerminalPathWitnessWork(1) // no last-write-wins: preserve ambiguity
      state.witnesses.set(key, null)
      return
    }
    this.reserveTerminalPathWitnessWork(1) // safe translation/extent predicate
    if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy) || !Number.isSafeInteger(dx + admission.width) || !Number.isSafeInteger(dy + admission.height) || dx < 0 || dy < 0) return
    const ports = this.ports.get(key) ?? []
    if (ports.length !== 2) return
    let starts = 0,
      ends = 0
    for (const port of ports) {
      this.reserveTerminalPathWitnessWork(1)
      const expected = port.end === 'start' ? admission.route.source : admission.route.target
      if (port.end !== expected.end || port.nodeId !== expected.nodeId || port.side !== expected.side || port.x !== expected.x + dx || port.y !== expected.y + dy || port.markerProjection || port.boundary?.id !== expected.boundary?.id || port.boundary?.kind !== expected.boundary?.kind) return
      if (port.end === 'start') starts++
      else ends++
    }
    if (starts !== 1 || ends !== 1) return
    this.reserveTerminalPathWitnessWork(2) // immutable descriptor and map entry before allocation
    state.witnesses.set(key, Object.freeze({ owner: canonical, token: token as object, dx, dy }))
  }

  /** A sparse empty layer with the same extent, suitable for positioned drawing. */
  blank(): TerminalDocument {
    return new TerminalDocument(this.width, this.height)
  }

  overlay(other: TerminalDocument, dx = 0, dy = 0): void {
    integer(dx, 'offset x')
    integer(dy, 'offset y')
    this.admitOwners(other.elements.values())
    this.resize(dx + other.width, dy + other.height)
    this.titleHandled ||= other.titleHandled
    if (other.lineWidths) {
      this.lineWidths ??= Array.from({ length: this.height }, () => this.width)
      for (let y = 0; y < other.height; y++) this.lineWidths[y + dy] = Math.max(this.lineWidths[y + dy] ?? 0, dx + (other.lineWidths[y] ?? other.width))
    }
    const blocks = new Map<TextBlock, TextBlock>()
    // Preflight whole source text groups while retaining ordinary replay order
    // for their accepted cells and all ungrouped geometry.
    const groups = new Map<TextBlock, Array<{ x: number; y: number; cell: TerminalCell }>>()
    const admitted = new Map<TextBlock, boolean>()
    const scopedBlocks = new Set<TextBlock>()
    for (const [y, row] of other.rows)
      for (const [x, cell] of row) {
        if (!cell.textBlock || cell.glyph === WIDE_CHAR_CONTINUATION) continue
        const group = groups.get(cell.textBlock) ?? []
        group.push({ x, y, cell })
        groups.set(cell.textBlock, group)
      }
    for (const [y, row] of other.rows)
      for (const [x, cell] of row) {
        if (cell.glyph === WIDE_CHAR_CONTINUATION) continue
        this.metrics.overlayVisits++
        let block: TextBlock | undefined
        if (cell.textBlock) {
          if (!admitted.has(cell.textBlock))
            admitted.set(
              cell.textBlock,
              groups.get(cell.textBlock)!.every(item => {
                const paint = { ...item.cell, owner: this.remember(item.cell.owner ?? this.activeOwner) }
                return this.admit(item.x + dx, item.y + dy, item.cell.glyph, item.cell.width, paint, this.paintOwners(paint), true)
              }),
            )
          if (!admitted.get(cell.textBlock)) continue
          block = blocks.get(cell.textBlock)
          if (!block) {
            block = this.movedTextBlock(cell.textBlock, cell.textBlock.x + dx, cell.textBlock.y + dy)
            blocks.set(cell.textBlock, block)
          }
        }
        const owner = this.remember(cell.owner ?? this.activeOwner)
        if (block && !cell.owner && this.activeOwner) {
          if (!scopedBlocks.has(cell.textBlock!)) {
            this.attributeTextAllocations(block, this.paintOwners({ owner: this.activeOwner }))
            scopedBlocks.add(cell.textBlock!)
          }
          if (this.activeTextBlock && this.activeTextBlock !== block) {
            Object.assign(this.activeTextBlock, union(this.activeTextBlock, block))
            if (block.allocations) (this.activeTextBlock.allocations ??= []).push(...block.allocations)
            if (block.emptyRows) for (const [row, owners] of block.emptyRows) this.recordEmptyRows(this.activeTextBlock, row, [0], this.unionOwners(owners, this.paintOwners({ owner: this.activeOwner })))
          } else if (!this.activeTextBlock) {
            this.activeTextBlock = block
            if (block.emptyRows) for (const [row, owners] of block.emptyRows) block.emptyRows.set(row, this.unionOwners(owners, this.paintOwners({ owner: this.activeOwner })))
          }
          block = this.activeTextBlock
          blocks.set(cell.textBlock!, block)
        }
        if (block) this.retainedTextBlocks.add(block)
        if (!this.place(x + dx, y + dy, cell.glyph, cell.width, { ...cell, owner }, block)) continue
      }
    for (const block of other.retainedTextBlocks)
      if (!groups.has(block)) {
        const moved = this.movedTextBlock(block, block.x + dx, block.y + dy)
        if (this.activeOwner) this.attributeTextAllocations(moved, this.paintOwners({ owner: this.activeOwner }))
        this.retainedTextBlocks.add(moved)
      }
    for (const owner of other.elements.values()) this.remember(owner)
    for (const [key, bounds] of other.declared) this.region(other.elements.get(key)!, { ...bounds, x: bounds.x + dx, y: bounds.y + dy })
    for (const [key, ports] of other.ports) for (const port of ports) this.port(other.elements.get(key)!, { ...port, x: port.x + dx, y: port.y + dy })
    this.reserveStrokeProvenance(other.strokeProvenanceWork)
    const inheritedPaths = pathWitnessStates.get(other)
    if (inheritedPaths) {
      this.reserveTerminalPathWitnessWork(inheritedPaths.work)
      for (const [key, witness] of inheritedPaths.witnesses) {
        this.reserveTerminalPathWitnessWork(1) // translated descriptor/ambiguity copy
        if (!witness) pathWitnessStates.get(this)!.witnesses.set(key, null)
        else this.registerTerminalPathWitness(witness.owner, witness.token, witness.dx + dx, witness.dy + dy)
      }
    }
    for (const diagnostic of other.diagnostics) this.addDiagnostic(diagnostic.cell ? { ...diagnostic, cell: { column: diagnostic.cell.column + dx, row: diagnostic.cell.row + dy } } : diagnostic, other.diagnosticKey(diagnostic))
  }

  /** Reflect positioned primitives. Text blocks retain their reading order. */
  flip(horizontal: boolean, vertical: boolean): void {
    const paths = pathWitnessStates.get(this)
    if (paths && (horizontal || vertical)) {
      for (const _ of paths.witnesses) this.reserveTerminalPathWitnessWork(1)
      this.reserveTerminalPathWitnessWork(1)
      paths.witnesses.clear() // connected intent remains; transformed geometry uses ordinary BFS
    }
    const lineWidths = this.lineWidths
    const allocatedRows = new Map<number, number>()
    if (lineWidths && vertical && !horizontal)
      for (let y = 0; y < this.height; y++) {
        let occupiedEnd = 0
        for (const x of this.rows.get(y)?.keys() ?? []) occupiedEnd = Math.max(occupiedEnd, x + 1)
        const width = lineWidths[y] ?? this.width
        if (width > occupiedEnd) allocatedRows.set(this.height - 1 - y, width)
      }
    this.lineWidths = undefined
    const next = new Map<number, Map<number, TerminalCell>>()
    const blocks = new Map<TextBlock, TextBlock>()
    for (const block of this.retainedTextBlocks) blocks.set(block, this.movedTextBlock(block, horizontal ? this.width - block.x - block.width : block.x, vertical ? this.height - block.y - block.height : block.y))
    this.retainedTextBlocks = new Set(blocks.values())
    type MovedCell = { x: number; y: number; cell: TerminalCell; block?: TextBlock }
    const moved: MovedCell[] = []
    const diagnosticCount = this.diagnostics.length
    const diagnosticSites = new Set(this.diagnostics.flatMap(diagnostic => (diagnostic.cell ? [`${diagnostic.cell.column},${diagnostic.cell.row}`] : [])))
    const movedSites = new Map<string, { column: number; row: number }>()
    for (const [y, row] of this.rows)
      for (const [x, cell] of row) {
        if (cell.glyph === WIDE_CHAR_CONTINUATION) continue
        let nx = horizontal ? this.width - cell.width - x : x
        let ny = vertical ? this.height - 1 - y : y
        let block: TextBlock | undefined
        let glyph = cell.glyph
        let stroke = cell.stroke,
          marker = cell.marker,
          numericMark = cell.numericMark
        const readableBlock = cell.textBlock
        if ((cell.kind === 'text' || cell.kind === 'surface') && readableBlock) {
          const old = readableBlock
          block = blocks.get(old)
          if (!block) {
            block = this.movedTextBlock(old, horizontal ? this.width - old.x - old.width : old.x, vertical ? this.height - old.y - old.height : old.y)
            blocks.set(old, block)
          }
          nx = block.x + x - old.x
          ny = block.y + y - old.y
        } else if (stroke) {
          stroke = Object.freeze({ ...stroke, mask: reflectedMask(stroke.mask, horizontal, vertical) })
          glyph = strokeGlyph(stroke)
        } else if (marker) {
          marker = reflectedMarker(marker, horizontal, vertical)
          glyph = markerGlyph(marker)
        } else if (numericMark) {
          if ((numericMark.axis === 'horizontal' && horizontal) || (numericMark.axis === 'vertical' && vertical)) numericMark = Object.freeze({ ...numericMark, coverage: numericMark.coverage === 1 ? 2 : numericMark.coverage === 2 ? 1 : 3 })
          glyph = numericMarkGlyph(numericMark)
        } else {
          if (horizontal) glyph = flipXGlyph[glyph] ?? glyph
          if (vertical) glyph = flipYGlyph[glyph] ?? glyph
        }
        const placed = { ...cell, glyph, head: nx, ...(stroke ? { stroke } : {}), ...(marker ? { marker } : {}), ...(numericMark ? { numericMark } : {}), ...(block ? { textBlock: block } : {}) }
        const contributions = cell[strokeContributions]
        if (contributions !== undefined) {
          if (typeof contributions === 'number') placed[strokeContributions] = reflectedMask(contributions, horizontal, vertical)
          else {
            this.reserveStrokeProvenance(contributions.length * 2 + 1)
            placed[strokeContributions] = Object.freeze(contributions.map(mask => reflectedMask(mask, horizontal, vertical)))
          }
        }
        moved.push({ x: nx, y: ny, cell: placed, ...(block ? { block } : {}) })
        for (let offset = 0; diagnosticSites.size > 0 && offset < cell.width; offset++) {
          const site = `${x + offset},${y}`
          if (diagnosticSites.has(site)) movedSites.set(site, { column: nx + offset, row: ny })
        }
      }
    this.rows = next
    for (const bounds of this.declared.values()) {
      if (horizontal) bounds.x = this.width - bounds.x - bounds.width
      if (vertical) bounds.y = this.height - bounds.y - bounds.height
    }
    for (const ports of this.ports.values())
      for (const port of ports) {
        if (horizontal) {
          port.x = this.width - 1 - port.x
          if (port.side === 'L') port.side = 'R'
          else if (port.side === 'R') port.side = 'L'
        }
        if (vertical) {
          port.y = this.height - 1 - port.y
          if (port.side === 'T') port.side = 'B'
          else if (port.side === 'B') port.side = 'T'
        }
        if (port.markers) port.markers = Object.freeze(port.markers.map(marker => reflectedMarker(marker, horizontal, vertical)))
      }
    for (let index = 0; index < diagnosticCount; index++) {
      const diagnostic = this.diagnostics[index]!
      if (diagnostic.cell) {
        const reflected = {
          ...diagnostic,
          cell: movedSites.get(`${diagnostic.cell.column},${diagnostic.cell.row}`) ?? {
            column: horizontal ? this.width - 1 - diagnostic.cell.column : diagnostic.cell.column,
            row: vertical ? this.height - 1 - diagnostic.cell.row : diagnostic.cell.row,
          },
        }
        this.diagnosticIdentities.set(reflected, this.diagnosticKey(diagnostic))
        this.diagnostics[index] = reflected
      }
    }
    // Background geometry is admitted before complete readable text footprints.
    // Reuse ordinary composition's collision policy instead of overwriting
    // cells that move to the same destination.
    const groups = new Map<TextBlock, MovedCell[]>()
    const activeOwner = this.activeOwner
    this.activeOwner = undefined
    try {
      for (const item of moved) if (!item.block && item.cell.kind === 'surface') this.place(item.x, item.y, item.cell.glyph, item.cell.width, item.cell, undefined)
      for (const item of moved) {
        if (item.block) {
          const group = groups.get(item.block) ?? []
          group.push(item)
          groups.set(item.block, group)
        } else if (item.cell.kind !== 'surface') this.place(item.x, item.y, item.cell.glyph, item.cell.width, item.cell, undefined)
      }
      for (const [block, group] of groups) {
        if (!group.every(item => this.admit(item.x, item.y, item.cell.glyph, item.cell.width, item.cell, this.paintOwners(item.cell), true))) continue
        for (const item of group) this.place(item.x, item.y, item.cell.glyph, item.cell.width, item.cell, block)
      }
    } finally {
      this.activeOwner = activeOwner
    }
    this.activeTextBlock = undefined
    this.textGroups.clear()
    this.emittedWidths = undefined
    if ((horizontal || vertical) && lineWidths)
      this.lineWidths = Array.from({ length: this.height }, (_, y) => {
        let end = allocatedRows.get(y) ?? 0
        for (const x of this.rows.get(y)?.keys() ?? []) end = Math.max(end, x + 1)
        return end
      })
    else this.lineWidths = lineWidths
  }

  serialize(options: TerminalSerializeOptions = {}): string {
    this.assertMarkers()
    this.metrics.outputCells = 0
    const mode = options.colorMode ?? 'none',
      theme = options.theme ?? DEFAULT_ASCII_THEME
    const lines: string[] = [],
      widths: number[] = []
    for (let y = 0; y < this.height; y++) {
      const rowWidth = this.lineWidths?.[y] ?? this.width
      let width = rowWidth
      if (options.trimEnd) while (width > 0 && this.get(width - 1, y) === ' ' && this.cell(width - 1, y)?.kind !== 'text') width--
      widths.push(width)
      if (mode === 'none') {
        // Color boundaries do not affect plain bytes. Keep final sanitation:
        // callers can inspect and mutate retained cells between serializations.
        let line = ''
        const row = this.rows.get(y)
        for (let x = 0; x < width; x++) {
          const glyph = row?.get(x)?.glyph ?? ' '
          if (glyph !== WIDE_CHAR_CONTINUATION) line += glyph
        }
        lines.push(sanitizeTerminalText(line))
        this.metrics.outputCells += width
        continue
      }
      let line = '',
        buffer = '',
        lastRole: CharRole | null | undefined,
        lastColor: string | undefined
      const flush = (): void => {
        if (!buffer) return
        line += lastColor ? colorizeText(buffer, lastColor, mode) : colorizeLine([buffer], [lastRole ?? null], theme, mode)
        buffer = ''
      }
      for (let x = 0; x < width; x++) {
        const cell = this.cell(x, y),
          glyph = cell?.glyph ?? ' '
        if (glyph === WIDE_CHAR_CONTINUATION) continue
        if (glyph === ' ') {
          flush()
          line += ' '
          lastRole = undefined
          lastColor = undefined
          continue
        }
        const role = cell?.role ?? null,
          color = cell?.color
        if (role !== lastRole || color !== lastColor) {
          flush()
          lastRole = role
          lastColor = color
        }
        buffer += glyph
      }
      flush()
      lines.push(line)
      this.metrics.outputCells += width
    }
    if (options.trimEnd)
      while (lines.length > 0 && widths.at(-1) === 0) {
        lines.pop()
        widths.pop()
      }
    this.emittedWidths = widths
    this.emittedColorMode = mode
    return (this.emittedText = lines.join('\n'))
  }

  /** Retained native evidence. Iterables are consumed only by bounded final certification. */
  layoutEvidence() {
    const document = this
    return {
      width: this.width,
      height: this.height,
      emittedWidths: this.emittedWidths as readonly number[] | undefined,
      emittedText: this.emittedText,
      colorMode: this.emittedColorMode,
      owners: this.elements.values(),
      pathWitnessWork: pathWitnessStates.get(this)?.work ?? 0,
      strokeProvenanceWork: this.strokeProvenanceWork,
      pathWitnesses: pathWitnessStates.get(this)?.witnesses.values(),
      declarations: (function* () {
        for (const [key, bounds] of document.declared) yield [document.elements.get(key)!, bounds] as const
      })(),
      ports: (function* () {
        for (const [key, ports] of document.ports) for (const port of ports) yield [document.elements.get(key)!, port] as const
      })(),
      textAllocations: (function* () {
        for (const block of document.retainedTextBlocks) for (const allocation of block.allocations ?? []) yield allocation
      })(),
    }
  }

  regions(): TerminalRegion[] {
    type Positioned = { x: number; y: number; cell: TerminalCell }
    const groups = new Map<string, { owner: TerminalOwner; cells: Positioned[]; occluded: Positioned[] }>()
    const groupFor = (owner: TerminalOwner) => {
      const key = ownerKey(owner)
      let group = groups.get(key)
      if (!group) {
        group = { owner, cells: [], occluded: [] }
        groups.set(key, group)
      }
      return group
    }
    for (const [y, row] of this.rows)
      for (const [x, cell] of row) {
        if (this.emittedWidths && (y >= this.emittedWidths.length || x >= this.emittedWidths[y]!)) continue
        for (const owner of cell.owners) groupFor(owner).cells.push({ x, y, cell })
        if (cell.occludedOwners) for (const owner of cell.occludedOwners) if (!cell.owners.some(visible => ownerKey(visible) === ownerKey(owner))) groupFor(owner).occluded.push({ x, y, cell })
      }
    for (const [key] of this.declared) if (!groups.has(key)) groupFor(this.elements.get(key)!)
    const result: TerminalRegion[] = []
    const byPosition = (a: Positioned, b: Positioned) => a.y - b.y || a.x - b.x
    const cellSpans = (ordered: Positioned[]): TerminalCellSpan[] => {
      const spans: TerminalCellSpan[] = []
      for (const { x, y } of ordered) {
        const last = spans.at(-1)
        if (last && last.row === y && last.end === x) last.end++
        else spans.push({ row: y, start: x, end: x + 1 })
      }
      return spans
    }
    for (const [key, { owner, cells, occluded }] of groups) {
      const ordered = cells.sort(byPosition)
      const text = ordered.filter(item => item.cell.kind === 'text')
      const firstBlock = text[0]?.cell.textBlock
      const label = firstBlock ? text.filter(item => item.cell.textBlock === firstBlock) : text
      const selected = cells.length === 0 ? occluded : owner.kind === 'edge' ? cells : label.length > 0 ? label : cells
      const declared = this.declared.get(key)
      if (selected.length === 0 && !declared) continue
      let bounds =
        declared ??
        selected.reduce<TerminalBounds | undefined>((previous, item) => {
          const cellBounds = { x: item.x, y: item.y, width: 1, height: 1 }
          return previous ? union(previous, cellBounds) : cellBounds
        }, undefined)!
      const authored = label.filter(({ cell }) => cell.glyph !== WIDE_CHAR_CONTINUATION)
      const projectedRows = new Map<number, string>()
      for (const [row, owners] of firstBlock?.emptyRows ?? []) if (owners.some(candidate => ownerKey(candidate) === key)) projectedRows.set(row, '')
      for (const item of authored) projectedRows.set(item.y, (projectedRows.get(item.y) ?? '') + item.cell.glyph)
      const projectedText = [...projectedRows]
        .sort(([a], [b]) => a - b)
        .map(([, text]) => text)
        .join('\n')
      if (!declared && projectedRows.size) {
        let first = bounds.y,
          end = bounds.y + bounds.height
        for (const row of projectedRows.keys()) {
          first = Math.min(first, row)
          end = Math.max(end, row + 1)
        }
        bounds = { ...bounds, y: first, height: end - first }
      }
      result.push({
        id: owner.id,
        kind: owner.kind ?? 'node',
        ...(owner.sourceLine === undefined ? {} : { sourceLine: owner.sourceLine }),
        ...(owner.parent === undefined ? {} : { parentId: owner.parent.id, parentKind: owner.parent.kind }),
        ...(owner.annotationTarget === undefined ? {} : { annotationTarget: owner.annotationTarget }),
        ...(owner.members === undefined ? {} : { members: owner.members }),
        ...(owner.from === undefined ? {} : { from: owner.from }),
        ...(owner.to === undefined ? {} : { to: owner.to }),
        ...(owner.bundle === undefined ? {} : { bundle: owner.bundle }),
        ...(this.ports.has(key) ? { ports: this.ports.get(key)!.map(port => ({ ...port })) } : {}),
        canvasRow: bounds.y,
        canvasColStart: bounds.x,
        canvasColEnd: bounds.x + bounds.width,
        ...(bounds.height > 1 ? { rowSpan: bounds.height } : {}),
        ...(authored.length === 0 ? {} : { projectedText, authoredTextCells: authored.map(({ x, y, cell }) => ({ row: y, column: x, glyph: cell.glyph })) }),
        ownedCellSpans: cellSpans(ordered),
        ...(occluded.length ? { occludedCellSpans: cellSpans(occluded.sort(byPosition)) } : {}),
      })
    }
    return result.sort((a, b) => a.canvasRow - b.canvasRow || a.canvasColStart - b.canvasColStart || compareCodePointStrings(a.id, b.id))
  }
}

const artifacts = new WeakMap<object, TerminalDocument>()

export function retainTerminalDocument(result: object, document: TerminalDocument | undefined): void {
  if (document) artifacts.set(result, document)
}
export function terminalDocumentOf(result: object): TerminalDocument | undefined {
  return artifacts.get(result)
}
