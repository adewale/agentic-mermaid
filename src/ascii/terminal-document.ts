import type { RenderedRegionKind } from '../agent/types.ts'
import type { TerminalProjectionDiagnostic } from '../terminal-style.ts'
import { graphemes } from '../shared/graphemes.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'
import { sanitizeTerminalText } from '../terminal-security.ts'
import { colorizeLine, colorizeText, DEFAULT_ASCII_THEME } from './ansi.ts'
import type { AsciiTheme, CharRole, ColorMode } from './types.ts'
import { charVisualWidth, visualWidth, WIDE_CHAR_CONTINUATION } from './width.ts'

export interface TerminalIdentity {
  id: string
  kind: Exclude<RenderedRegionKind, 'canvas'> | 'subgraph'
}
export interface TerminalOwner {
  id: string
  kind?: TerminalIdentity['kind']
  sourceLine?: number
  parent?: Readonly<TerminalIdentity>
  members?: readonly string[]
  /** Shared runs may join only when their family layout declares a bundle. */
  bundle?: string
  from?: string
  to?: string
}

export interface TerminalBounds { x: number; y: number; width: number; height: number }
declare const ownerSetBrand: unique symbol
declare const elementBrand: unique symbol
export type TerminalElement = Readonly<TerminalOwner> & { readonly [elementBrand]: true }
export type TerminalOwnerSet = readonly TerminalOwner[] & { readonly [ownerSetBrand]: true }
export type TerminalSide = 'T' | 'R' | 'B' | 'L'
export const TERMINAL_STROKE_PORTS = { T: 1, R: 2, B: 4, L: 8 } as const
export type TerminalLineStyle = 'solid' | 'dashed' | 'dotted' | 'heavy' | 'double'
export interface TerminalStroke { mask: number; ascii?: boolean; style?: TerminalLineStyle; rounded?: boolean }
export interface TerminalMarker { shape: 'arrow' | 'triangle' | 'open-arrow' | 'circle' | 'cross' | 'diamond'; direction?: TerminalSide; ascii?: boolean }
export interface TerminalNumericMark { axis: 'horizontal' | 'vertical'; coverage: 1 | 2 | 3; ascii?: boolean }
const measuredBrand = Symbol('measured terminal text')
export interface MeasuredTerminalText {
  readonly [measuredBrand]: true
  readonly width: number
  readonly height: number
  readonly emptyRows: readonly number[]
  readonly lines: readonly (readonly { readonly glyph: string; readonly x: number; readonly width: number }[])[]
}
export interface AllocatedTerminalText extends TerminalBounds { readonly text: MeasuredTerminalText }

/** Sanitize and measure once, before choosing a position or testing occupancy. */
export function measuredText(value: string | readonly string[]): MeasuredTerminalText {
  const rows = sanitizeTerminalText(typeof value === 'string' ? value : value.join('\n'), true).split('\n')
  let maximum = 0
  const lines = rows.map(line => {
    let x = 0
    const clusters = [...graphemes(line)].flatMap(glyph => {
      const width = visualWidth(glyph)
      if (!width) return []
      const cluster = Object.freeze({ glyph, x, width }); x += width
      return [cluster]
    })
    maximum = Math.max(maximum, x)
    return Object.freeze(clusters)
  })
  return Object.freeze({ [measuredBrand]: true as const, width: maximum, height: lines.length, emptyRows: Object.freeze(rows.flatMap((row, index) => row.length === 0 ? [index] : [])), lines: Object.freeze(lines) })
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
export interface TerminalRun extends TerminalPaint { text: string }
export interface TerminalSerializeOptions {
  colorMode?: ColorMode
  theme?: AsciiTheme
  trimEnd?: boolean
}
interface TextBlock extends TerminalBounds {
  /** Authored empty rows carry meaning but never fabricate occupied cells. */
  emptyRows?: Map<number, TerminalOwnerSet>
}
export interface TerminalCell extends TerminalPaint {
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
export interface TerminalCellSpan { row: number; start: number; end: number }
export interface TerminalPort { nodeId: string; x: number; y: number; side?: 'T' | 'B' | 'L' | 'R'; end: 'start' | 'end' }
export interface TerminalRegion {
  id: string
  kind: NonNullable<TerminalOwner['kind']>
  sourceLine?: number
  parentId?: string
  parentKind?: TerminalIdentity['kind']
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
const geometryRelated = (a: TerminalOwner, b: TerminalOwner): boolean => ownerKey(a) === ownerKey(b)
  || !!(a.bundle && a.bundle === b.bundle)
  || !!(a.parent && ownerKey(a.parent) === ownerKey(b))
  || !!(b.parent && ownerKey(b.parent) === ownerKey(a))
const textGroupKey = (owner: TerminalOwner | undefined, group: string | undefined): string | undefined => group === undefined
  ? undefined : JSON.stringify([owner ? [owner.kind ?? 'node', owner.id] : null, group])
// Only snapshots created by this module may back identity-based import caches.
const canonicalOwnerDefinitions = new WeakSet<TerminalOwner>()
const canonicalOwnerSets = new WeakSet<readonly TerminalOwner[]>()
const emptyOwners = Object.freeze([]) as unknown as TerminalOwnerSet
canonicalOwnerSets.add(emptyOwners)
const definitionFields = ['sourceLine', 'parent', 'bundle', 'from', 'to', 'members'] as const

function snapshotOwner(owner: TerminalOwner): TerminalOwner {
  if (canonicalOwnerDefinitions.has(owner)) return owner
  const snapshot = { ...owner }
  if (snapshot.parent) snapshot.parent = Object.freeze({ ...snapshot.parent })
  if (snapshot.members) snapshot.members = Object.freeze([...snapshot.members])
  Object.freeze(snapshot)
  canonicalOwnerDefinitions.add(snapshot)
  return snapshot
}

function validateOwner(previous: TerminalOwner, incoming: TerminalOwner): void {
  for (const field of definitionFields) {
    const value = incoming[field]
    if (value !== undefined && (field === 'members'
      ? JSON.stringify(value) !== JSON.stringify(previous[field])
      : field === 'parent' ? ownerKey(value as TerminalIdentity) !== (previous.parent ? ownerKey(previous.parent) : undefined)
        : value !== previous[field])) throw new Error(`Inconsistent terminal element ${incoming.id}: ${field}`)
  }
}
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

function strokeGlyph(stroke: TerminalStroke): string {
  const { mask, ascii = false, style = 'solid' } = stroke
  const horizontal = (mask & 10) !== 0, vertical = (mask & 5) !== 0
  if (ascii) return horizontal && vertical ? '+' : horizontal ? style === 'dashed' || style === 'dotted' ? '.' : style === 'double' || style === 'heavy' ? '=' : '-' : style === 'dashed' || style === 'dotted' ? ':' : '|'
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
  const direction = marker.direction ?? 'R', index = ['T', 'R', 'B', 'L'].indexOf(direction)
  if (marker.shape === 'circle') return marker.ascii ? 'o' : '○'
  if (marker.shape === 'cross') return marker.ascii ? 'x' : '✕'
  if (marker.shape === 'diamond') return marker.ascii ? 'o' : '◆'
  if (marker.ascii) return ['^', '>', 'v', '<'][index]!
  return (marker.shape === 'open-arrow' ? ['△', '▷', '▽', '◁'] : marker.shape === 'triangle' ? ['▲', '▶', '▼', '◀'] : ['▲', '►', '▼', '◄'])[index]!
}
function numericMarkGlyph(mark: TerminalNumericMark): string {
  return mark.ascii ? '#' : mark.coverage === 3 ? '█' : mark.axis === 'horizontal' ? mark.coverage === 1 ? '▌' : '▐' : mark.coverage === 1 ? '▄' : '▀'
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
  private diagnosticKeys = new Set<string>()
  private diagnosticIdentities = new WeakMap<TerminalProjectionDiagnostic, string>()
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
  hasOwner(id: string, kind?: TerminalOwner['kind']): boolean { return [...this.elements.values()].some(owner => owner.id === id && (kind === undefined || owner.kind === kind)) }

  *entries(): IterableIterator<readonly [number, number, TerminalCell]> {
    for (const [y, row] of this.rows) for (const [x, cell] of row) yield [x, y, cell] as const
  }

  /** Attach identity at a family drawing boundary, retaining explicit text cells. */
  attribute(owners: TerminalOwner | readonly TerminalOwner[], paint: Omit<TerminalPaint, 'owner'> = {}): this {
    const canonical = this.owners(Array.isArray(owners) ? owners : [owners])
    const blocks = new Set<TextBlock>()
    for (const [, , cell] of this.entries()) {
      if (cell.textBlock) blocks.add(cell.textBlock)
      cell.owners = this.unionOwners(cell.owners, canonical)
      cell.owner ??= canonical[0]
      if (cell.kind !== 'text') {
        if (paint.role !== undefined) cell.role = paint.role
        if (paint.kind !== undefined) cell.kind = paint.kind
      }
      if (paint.color !== undefined) cell.color = paint.color
    }
    for (const block of blocks) {
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
      cell.owners = this.unionOwners(cell.owners, canonical)
      if (cell.textBlock) blocks.add(cell.textBlock)
      if (paint.role !== undefined && cell.kind !== 'text') cell.role = paint.role
      if (paint.color !== undefined) cell.color = paint.color
    }
    for (const block of blocks) {
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
    const definitions: TerminalOwner[] = [], pending = new Map<string, TerminalOwner>(), snapshots = new WeakMap<TerminalOwner, TerminalOwner>()
    for (const supplied of values) {
      if (this.canonicalOwners.has(supplied)) { definitions.push(supplied); continue }
      const owner = snapshots.get(supplied) ?? snapshotOwner(supplied), key = ownerKey(owner)
      snapshots.set(supplied, owner)
      const previous = pending.get(key) ?? this.elements.get(key)
      if (previous) validateOwner(previous, owner)
      else pending.set(key, owner)
      definitions.push(previous ?? owner)
    }
    for (const [key, owner] of pending) {
      this.elements.set(key, owner); this.canonicalOwners.add(owner); this.ownerKeys.set(owner, key)
    }
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
    const keys = [...byKey.keys()].sort(compareCodePointStrings), key = JSON.stringify(keys)
    let set = this.ownerSets.get(key)
    if (!set) {
      set = Object.freeze(keys.map(key => byKey.get(key)!)) as TerminalOwnerSet
      canonicalOwnerSets.add(set); this.ownerSets.set(key, set); this.importedOwners.set(set, set)
    }
    if (cacheable) this.importedOwners.set(values as readonly TerminalOwner[], set)
    return set
  }

  private singletonOwnerSet(owner: TerminalOwner): TerminalOwnerSet {
    let set = this.singletonOwners.get(owner)
    if (!set) {
      set = Object.freeze([owner]) as TerminalOwnerSet
      canonicalOwnerSets.add(set)
      this.singletonOwners.set(owner, set); this.importedOwners.set(set, set)
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
    return { ...paint, owner: primary ? definitions[supplied.length] : undefined, owners: this.owners(definitions.slice(0, count)),
      ...(occluded ? { occludedOwners: this.owners(definitions.slice(count)) } : {}) }
  }

  private unionOwners(left: readonly TerminalOwner[], right: readonly TerminalOwner[]): TerminalOwnerSet {
    const a = this.owners(left), b = this.owners(right)
    if (!a.length || a === b) return b
    if (!b.length) return a
    let unions = this.ownerUnions.get(a)
    const cached = unions?.get(b) ?? this.ownerUnions.get(b)?.get(a)
    if (cached) return cached
    const combined = a.every(owner => b.includes(owner)) ? b
      : b.every(owner => a.includes(owner)) ? a
      : this.owners([...a, ...b])
    if (!unions) { unions = new WeakMap(); this.ownerUnions.set(a, unions) }
    unions.set(b, combined)
    return combined
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
    const remembered = this.remember(owner)!, key = ownerKey(remembered)
    this.resize(bounds.x + bounds.width, bounds.y + bounds.height)
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
    this.addDiagnostic(diagnostic, this.diagnosticKey(diagnostic))
  }

  private diagnosticKey(diagnostic: TerminalProjectionDiagnostic): string {
    return this.diagnosticIdentities.get(diagnostic) ?? JSON.stringify(['feature', diagnostic.code, diagnostic.feature])
  }

  private addDiagnostic(diagnostic: TerminalProjectionDiagnostic, key: string): void {
    if (this.diagnosticKeys.has(key)) return
    this.diagnosticKeys.add(key); this.diagnosticIdentities.set(diagnostic, key); this.diagnostics.push(diagnostic)
  }

  private warn(code: TerminalCompositionDiagnostic['code'], owners: readonly TerminalOwner[], x: number, y: number): void {
    const canonical = this.owners(owners)
    let cached = this.warningFeatures.get(canonical)
    if (!cached) {
      cached = { feature: owners.map(owner => `${owner.kind ?? 'node'}:${owner.id}`).sort(compareCodePointStrings).join('|'), keys: {} }
      this.warningFeatures.set(canonical, cached)
    }
    const feature = cached.feature
    const key = cached.keys[code] ??= JSON.stringify(['owners', code, canonical.map(owner => [owner.kind ?? 'node', owner.id])])
    if (this.diagnosticKeys.has(key)) return
    const description = code === 'TERMINAL_TEXT_COLLISION' ? 'Text footprints overlap' : code === 'TERMINAL_ROUTE_OVERLAP' ? 'Unrelated route runs overlap' : 'Incompatible occupied geometry overlaps'
    this.addDiagnostic({ code, feature, cell: { column: x, row: y }, message: `${description}; owners: ${owners.map(owner => owner.id).join(', ')}.` }, key)
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
    paint = this.canonicalPaint(paint)
    const owner = paint.owner
    const kind = paint.kind ?? 'stroke'
    if (glyph === ' ' && kind === 'stroke' && !owner) { this.resize(x + 1, y + 1); return }
    this.place(x, y, glyph, 1, { ...paint, owner, kind }, undefined)
  }

  private admit(x: number, y: number, glyph: string, width: number, paint: TerminalPaint, incoming: TerminalOwnerSet, strict = false): boolean {
    // Both sets contain this document's canonical immutable definitions.
    const related = (a: TerminalOwner, b: TerminalOwner, geometry = true) => a === b || (geometry && geometryRelated(a, b))
    const incompatible = (previous: readonly TerminalOwner[], bundles = true) => previous.length > 0 && incoming.length > 0 && (
      previous.some(owner => !incoming.some(next => related(owner, next, bundles))) || incoming.some(next => !previous.some(owner => related(owner, next, bundles))))
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
    const old = this.cell(x, y), incoming = this.paintOwners(paint)
    if (!this.admit(x, y, glyph, width, paint, incoming)) return false
    if (!block && paint.kind === 'surface' && old?.kind === 'surface' && old.textBlock && x >= old.textBlock.x && x + width <= old.textBlock.x + old.textBlock.width && this.compatibleTextSurface(old.owners, incoming)) block = old.textBlock
    if (old?.kind === 'mark' && paint.kind === 'stroke') {
      old.occludedOwners = this.unionOwners(old.occludedOwners ?? emptyOwners, incoming)
      return true
    }
    let owners = incoming
    const importedOcclusion = (paint as TerminalCell).occludedOwners
    let occludedOwners = importedOcclusion ? this.owners(importedOcclusion) : undefined
    if (old?.kind === 'marker' && paint.kind === 'marker') owners = this.unionOwners(old.owners, incoming)
    if (paint.kind === 'mark' && old?.kind === 'stroke') occludedOwners = this.unionOwners(this.unionOwners(old.owners, old.occludedOwners ?? emptyOwners), occludedOwners ?? emptyOwners)
    if (old?.kind === 'stroke' && paint.kind === 'stroke') {
      const a = old.stroke?.mask ?? strokePorts[old.glyph] ?? styledPorts[old.glyph] ?? asciiPorts[old.glyph]
      const b = paint.stroke?.mask ?? strokePorts[glyph] ?? styledPorts[glyph] ?? asciiPorts[glyph]
      if (paint.stroke || old.stroke) {
        const stroke = { ...(paint.stroke ?? old.stroke!), mask: (a ?? 0) | (b ?? 0) }
        paint = { ...paint, stroke }; glyph = strokeGlyph(stroke)
      } else if (a && b && a !== b) glyph = asciiPorts[old.glyph] === undefined && asciiPorts[glyph] === undefined ? portGlyph.get(a | b) ?? glyph : '+'
      owners = this.unionOwners(old.owners, incoming)
      if (a !== undefined && a === b && old.owners.some(previous => incoming.some(next => previous.kind === 'edge' && next.kind === 'edge' && previous.id !== next.id && !(previous.bundle && previous.bundle === next.bundle)))) this.warn('TERMINAL_ROUTE_OVERLAP', owners, x, y)
    }
    for (let offset = 0; offset < width; offset++) this.retire(x + offset, y)
    this.resize(x + width, y + 1)
    let row = this.rows.get(y)
    if (!row) { row = new Map(); this.rows.set(y, row) }
    const cell: TerminalCell = { ...paint, glyph, owners, head: x, width, ...(block ? { textBlock: block } : {}), ...(occludedOwners?.length ? { occludedOwners } : {}) }
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
      integer(x, 'x'); integer(y, 'y')
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

  mark(x: number, y: number, glyph: string, paint: TerminalPaint = {}): void { this.put(x, y, glyph, { ...paint, kind: 'mark' }) }

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
      for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) {
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

  private movedTextBlock(block: TextBlock, x: number, y: number): TextBlock {
    return { ...block, x, y, ...(block.emptyRows ? { emptyRows: new Map([...block.emptyRows].map(([row, owners]) => [row + y - block.y, this.owners(owners)])) } : {}) }
  }

  /** Complete immutable measured text is admitted as one allocation. */
  textBlock(x: number, y: number, value: string | readonly string[] | MeasuredTerminalText, paint: TerminalPaint = {}): Readonly<AllocatedTerminalText> | undefined {
    integer(x, 'x'); integer(y, 'y')
    const text = typeof value === 'object' && measuredBrand in value ? value : measuredText(value as string | readonly string[])
    paint = this.canonicalPaint(paint)
    const owner = paint.owner, incoming = this.paintOwners(paint)
    const ink = { ...paint, owner, kind: 'text' as const, role: paint.role === undefined ? 'text' as const : paint.role }
    for (let row = 0; row < text.height; row++) for (let column = 0; column < text.width; column++) if (!this.admit(x + column, y + row, ' ', 1, ink, incoming, true)) return undefined
    const bounds = { x, y, width: text.width, height: text.height }
    const groupKey = textGroupKey(owner, paint.textGroup)
    const scoped = owner !== undefined && owner === this.activeOwner
    let block = groupKey === undefined ? scoped ? this.activeTextBlock : undefined : this.textGroups.get(groupKey)
    const previous = block ? { ...block } : undefined
    if (block) Object.assign(block, union(block, bounds))
    else { block = { ...bounds }; if (scoped) this.activeTextBlock = block; if (groupKey !== undefined) this.textGroups.set(groupKey, block) }
    this.bindTextSurface(block, incoming, previous)
    for (let row = 0; row < text.height; row++) {
      let end = 0
      for (const cluster of text.lines[row]!) { this.place(x + cluster.x, y + row, cluster.glyph, cluster.width, ink, block); end = cluster.x + cluster.width }
      for (let column = end; column < text.width; column++) this.place(x + column, y + row, ' ', 1, { ...paint, owner, kind: 'surface' }, block)
    }
    this.recordEmptyRows(block, y, text.emptyRows, incoming)
    this.resize(x + text.width, y + text.height)
    return Object.freeze({ ...bounds, text })
  }

  text(x: number, y: number, text: string, paint: TerminalPaint = {}): TerminalBounds {
    integer(x, 'x'); integer(y, 'y')
    paint = this.canonicalPaint(paint)
    const owner = paint.owner
    text = sanitizeTerminalText(text, true)
    const lines = text.split('\n')
    const bounds = { x, y, width: Math.max(0, ...lines.map(visualWidth)), height: lines.length }
    const kind = paint.kind ?? 'text'
    const scoped = kind === 'text' && owner !== undefined && owner === this.activeOwner
    const groupKey = textGroupKey(owner, paint.textGroup)
    let block = groupKey === undefined ? scoped ? this.activeTextBlock : undefined : this.textGroups.get(groupKey)
    const previous = block ? { ...block } : undefined
    if (block) Object.assign(block, union(block, bounds))
    else { block = { ...bounds }; if (scoped) this.activeTextBlock = block; if (groupKey !== undefined) this.textGroups.set(groupKey, block) }
    if (kind === 'text') this.bindTextSurface(block, this.paintOwners({ ...paint, owner }), previous)
    let accepted = false
    lines.forEach((line, offsetY) => {
      let column = x
      for (const cluster of graphemes(line)) {
        const width = visualWidth(cluster)
        if (width > 0) {
          accepted = this.place(column, y + offsetY, cluster, width, { ...paint, owner, role: paint.role === undefined ? 'text' : paint.role, kind }, kind === 'text' ? block : undefined) || accepted
          column += width
        }
      }
    })
    if (kind === 'text' && (accepted || lines.every(line => line.length === 0))) this.recordEmptyRows(block, y, lines.flatMap((line, index) => line.length === 0 ? [index] : []), this.paintOwners(paint))
    this.resize(x + bounds.width, y + bounds.height)
    return bounds
  }

  fill(x: number, y: number, width: number, height: number, paint: TerminalPaint = {}): void {
    for (const [label, value] of Object.entries({ x, y, width, height })) integer(value, label)
    paint = this.canonicalPaint(paint)
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) this.put(col, row, ' ', { ...paint, kind: 'surface' })
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
      const count = owners.length + (owner ? 1 : 0), imported = definitions.slice(cursor, cursor + count)
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

  /** A sparse empty layer with the same extent, suitable for positioned drawing. */
  blank(): TerminalDocument { return new TerminalDocument(this.width, this.height) }

  overlay(other: TerminalDocument, dx = 0, dy = 0): void {
    integer(dx, 'offset x'); integer(dy, 'offset y')
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
    for (const [y, row] of other.rows) for (const [x, cell] of row) {
      if (!cell.textBlock || cell.glyph === WIDE_CHAR_CONTINUATION) continue
      const group = groups.get(cell.textBlock) ?? []
      group.push({ x, y, cell }); groups.set(cell.textBlock, group)
    }
    for (const [y, row] of other.rows) for (const [x, cell] of row) {
      if (cell.glyph === WIDE_CHAR_CONTINUATION) continue
      this.metrics.overlayVisits++
      let block: TextBlock | undefined
      if (cell.textBlock) {
        if (!admitted.has(cell.textBlock)) admitted.set(cell.textBlock, groups.get(cell.textBlock)!.every(item => {
          const paint = { ...item.cell, owner: this.remember(item.cell.owner ?? this.activeOwner) }
          return this.admit(item.x + dx, item.y + dy, item.cell.glyph, item.cell.width, paint, this.paintOwners(paint), true)
        }))
        if (!admitted.get(cell.textBlock)) continue
        block = blocks.get(cell.textBlock)
        if (!block) { block = this.movedTextBlock(cell.textBlock, cell.textBlock.x + dx, cell.textBlock.y + dy); blocks.set(cell.textBlock, block) }
      }
      const owner = this.remember(cell.owner ?? this.activeOwner)
      if (block && !cell.owner && this.activeOwner) {
        if (this.activeTextBlock && this.activeTextBlock !== block) {
          Object.assign(this.activeTextBlock, union(this.activeTextBlock, block))
          if (block.emptyRows) for (const [row, owners] of block.emptyRows) this.recordEmptyRows(this.activeTextBlock, row, [0], this.unionOwners(owners, this.paintOwners({ owner: this.activeOwner })))
        }
        else if (!this.activeTextBlock) {
          this.activeTextBlock = block
          if (block.emptyRows) for (const [row, owners] of block.emptyRows) block.emptyRows.set(row, this.unionOwners(owners, this.paintOwners({ owner: this.activeOwner })))
        }
        block = this.activeTextBlock
        blocks.set(cell.textBlock!, block)
      }
      if (!this.place(x + dx, y + dy, cell.glyph, cell.width, { ...cell, owner }, block)) continue
    }
    for (const owner of other.elements.values()) this.remember(owner)
    for (const [key, bounds] of other.declared) this.region(other.elements.get(key)!, { ...bounds, x: bounds.x + dx, y: bounds.y + dy })
    for (const [key, ports] of other.ports) for (const port of ports) this.port(other.elements.get(key)!, { ...port, x: port.x + dx, y: port.y + dy })
    for (const diagnostic of other.diagnostics) this.addDiagnostic(diagnostic.cell
      ? { ...diagnostic, cell: { column: diagnostic.cell.column + dx, row: diagnostic.cell.row + dy } }
      : diagnostic, other.diagnosticKey(diagnostic))
  }

  /** Reflect positioned primitives. Text blocks retain their reading order. */
  flip(horizontal: boolean, vertical: boolean): void {
    const lineWidths = this.lineWidths
    const allocatedRows = new Map<number, number>()
    if (lineWidths && vertical && !horizontal) for (let y = 0; y < this.height; y++) {
      let occupiedEnd = 0
      for (const x of this.rows.get(y)?.keys() ?? []) occupiedEnd = Math.max(occupiedEnd, x + 1)
      const width = lineWidths[y] ?? this.width
      if (width > occupiedEnd) allocatedRows.set(this.height - 1 - y, width)
    }
    this.lineWidths = undefined
    const next = new Map<number, Map<number, TerminalCell>>()
    const blocks = new Map<TextBlock, TextBlock>()
    type MovedCell = { x: number; y: number; cell: TerminalCell; block?: TextBlock }
    const moved: MovedCell[] = []
    const diagnosticCount = this.diagnostics.length
    const diagnosticSites = new Set(this.diagnostics.flatMap(diagnostic => diagnostic.cell ? [`${diagnostic.cell.column},${diagnostic.cell.row}`] : []))
    const movedSites = new Map<string, { column: number; row: number }>()
    for (const [y, row] of this.rows) for (const [x, cell] of row) {
      if (cell.glyph === WIDE_CHAR_CONTINUATION) continue
      let nx = horizontal ? this.width - cell.width - x : x
      let ny = vertical ? this.height - 1 - y : y
      let block: TextBlock | undefined
      let glyph = cell.glyph
      let stroke = cell.stroke, marker = cell.marker, numericMark = cell.numericMark
      const readableBlock = cell.textBlock
      if ((cell.kind === 'text' || cell.kind === 'surface') && readableBlock) {
        const old = readableBlock
        block = blocks.get(old)
        if (!block) {
          block = this.movedTextBlock(old, horizontal ? this.width - old.x - old.width : old.x, vertical ? this.height - old.y - old.height : old.y)
          blocks.set(old, block)
        }
        nx = block.x + x - old.x; ny = block.y + y - old.y
      } else if (stroke) {
        stroke = Object.freeze({ ...stroke, mask: reflectedMask(stroke.mask, horizontal, vertical) })
        glyph = strokeGlyph(stroke)
      } else if (marker) {
        let direction = marker.direction
        if (horizontal && (direction === 'L' || direction === 'R')) direction = direction === 'L' ? 'R' : 'L'
        if (vertical && (direction === 'T' || direction === 'B')) direction = direction === 'T' ? 'B' : 'T'
        marker = Object.freeze({ ...marker, direction }); glyph = markerGlyph(marker)
      } else if (numericMark) {
        if ((numericMark.axis === 'horizontal' && horizontal) || (numericMark.axis === 'vertical' && vertical)) numericMark = Object.freeze({ ...numericMark, coverage: numericMark.coverage === 1 ? 2 : numericMark.coverage === 2 ? 1 : 3 })
        glyph = numericMarkGlyph(numericMark)
      } else {
        if (horizontal) glyph = flipXGlyph[glyph] ?? glyph
        if (vertical) glyph = flipYGlyph[glyph] ?? glyph
      }
      const placed = { ...cell, glyph, head: nx, ...(stroke ? { stroke } : {}), ...(marker ? { marker } : {}), ...(numericMark ? { numericMark } : {}), ...(block ? { textBlock: block } : {}) }
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
    for (const ports of this.ports.values()) for (const port of ports) {
      if (horizontal) { port.x = this.width - 1 - port.x; if (port.side === 'L') port.side = 'R'; else if (port.side === 'R') port.side = 'L' }
      if (vertical) { port.y = this.height - 1 - port.y; if (port.side === 'T') port.side = 'B'; else if (port.side === 'B') port.side = 'T' }
    }
    for (let index = 0; index < diagnosticCount; index++) {
      const diagnostic = this.diagnostics[index]!
      if (diagnostic.cell) {
        const reflected = { ...diagnostic, cell: movedSites.get(`${diagnostic.cell.column},${diagnostic.cell.row}`) ?? {
          column: horizontal ? this.width - 1 - diagnostic.cell.column : diagnostic.cell.column,
          row: vertical ? this.height - 1 - diagnostic.cell.row : diagnostic.cell.row,
        } }
        this.diagnosticIdentities.set(reflected, this.diagnosticKey(diagnostic)); this.diagnostics[index] = reflected
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
        if (item.block) { const group = groups.get(item.block) ?? []; group.push(item); groups.set(item.block, group) }
        else if (item.cell.kind !== 'surface') this.place(item.x, item.y, item.cell.glyph, item.cell.width, item.cell, undefined)
      }
      for (const [block, group] of groups) {
        if (!group.every(item => this.admit(item.x, item.y, item.cell.glyph, item.cell.width, item.cell, this.paintOwners(item.cell), true))) continue
        for (const item of group) this.place(item.x, item.y, item.cell.glyph, item.cell.width, item.cell, block)
      }
    } finally { this.activeOwner = activeOwner }
    this.activeTextBlock = undefined
    this.textGroups.clear()
    this.emittedWidths = undefined
    if ((horizontal || vertical) && lineWidths) this.lineWidths = Array.from({ length: this.height }, (_, y) => {
      let end = allocatedRows.get(y) ?? 0
      for (const x of this.rows.get(y)?.keys() ?? []) end = Math.max(end, x + 1)
      return end
    })
    else this.lineWidths = lineWidths
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
    type Positioned = { x: number; y: number; cell: TerminalCell }
    const groups = new Map<string, { owner: TerminalOwner; cells: Positioned[]; occluded: Positioned[] }>()
    const groupFor = (owner: TerminalOwner) => {
      const key = ownerKey(owner)
      let group = groups.get(key)
      if (!group) { group = { owner, cells: [], occluded: [] }; groups.set(key, group) }
      return group
    }
    for (const [y, row] of this.rows) for (const [x, cell] of row) {
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
      let bounds = declared ?? selected.reduce<TerminalBounds | undefined>((previous, item) => {
        const cellBounds = { x: item.x, y: item.y, width: 1, height: 1 }
        return previous ? union(previous, cellBounds) : cellBounds
      }, undefined)!
      const authored = label.filter(({ cell }) => cell.glyph !== WIDE_CHAR_CONTINUATION)
      const projectedRows = new Map<number, string>()
      for (const [row, owners] of firstBlock?.emptyRows ?? []) if (owners.some(candidate => ownerKey(candidate) === key)) projectedRows.set(row, '')
      for (const item of authored) projectedRows.set(item.y, (projectedRows.get(item.y) ?? '') + item.cell.glyph)
      const projectedText = [...projectedRows].sort(([a], [b]) => a - b).map(([, text]) => text).join('\n')
      if (!declared && projectedRows.size) {
        let first = bounds.y, end = bounds.y + bounds.height
        for (const row of projectedRows.keys()) { first = Math.min(first, row); end = Math.max(end, row + 1) }
        bounds = { ...bounds, y: first, height: end - first }
      }
      result.push({
        id: owner.id, kind: owner.kind ?? 'node',
        ...(owner.sourceLine === undefined ? {} : { sourceLine: owner.sourceLine }),
        ...(owner.parent === undefined ? {} : { parentId: owner.parent.id, parentKind: owner.parent.kind }),
        ...(owner.members === undefined ? {} : { members: owner.members }),
        ...(owner.from === undefined ? {} : { from: owner.from }),
        ...(owner.to === undefined ? {} : { to: owner.to }),
        ...(owner.bundle === undefined ? {} : { bundle: owner.bundle }),
        ...(this.ports.has(key) ? { ports: this.ports.get(key)!.map(port => ({ ...port })) } : {}),
        canvasRow: bounds.y, canvasColStart: bounds.x, canvasColEnd: bounds.x + bounds.width,
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

export function retainTerminalDocument(result: object, document: TerminalDocument | undefined): void { if (document) artifacts.set(result, document) }
export function terminalDocumentOf(result: object): TerminalDocument | undefined { return artifacts.get(result) }
