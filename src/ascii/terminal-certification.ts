import { TERMINAL_CERTIFICATION_LIMITS } from './terminal-limits.ts'
import { terminalPathAdmission } from './terminal-route.ts'

export { TERMINAL_CERTIFICATION_LIMITS } from './terminal-limits.ts'

import { renderContractDigest } from '../render-contract.ts'
import { secureTerminalHtmlOutput, terminalOutputPlainText } from '../terminal-security.ts'
import { type TerminalDocument, type TerminalOwner, type TerminalPort, terminalCellConnections, terminalGlyphForPaint, terminalOwnedStrokeMask, terminalStrokeProvenanceMatches } from './terminal-document.ts'
import type { ColorMode } from './types.ts'
import { visualWidth, WIDE_CHAR_CONTINUATION } from './width.ts'

export type TerminalCertificationStatus = 'passed' | 'failed' | 'unverified'
export interface TerminalLayoutCertificationIssue {
  readonly code: string
  readonly status: Exclude<TerminalCertificationStatus, 'passed'>
  readonly message: string
  readonly elementId?: string
  readonly cell?: Readonly<{ column: number; row: number }>
}
export interface TerminalLayoutCertification {
  readonly version: 1
  readonly unit: 'cell'
  readonly scope: 'terminal-cells'
  readonly status: TerminalCertificationStatus
  /** Digest of the exact encoded text returned to this caller, not source/model data. */
  readonly outputDigest?: string
  readonly bounds?: Readonly<{ width: number; height: number }>
  readonly coverage: Readonly<{
    cells: number
    graphemes: number
    ownedCells: number
    unownedCells: number
    textAllocations: number
    textClusters: number
    identities: number
    ports: number
    markerContracts: number
  }>
  readonly budget: Readonly<{
    operations: number
    maxOperations: number
    outputCodeUnits: number
    maxOutputCodeUnits: number
    exhausted: boolean
    issuesTruncated: boolean
    projectionsTruncated: boolean
  }>
  readonly issues: readonly TerminalLayoutCertificationIssue[]
  /** Native representation choices are reported separately from cell-layout correctness. */
  readonly projections: readonly Readonly<{ feature: string; message: string }>[]
  readonly limitations: readonly string[]
}

export interface TerminalCertificationLimits {
  readonly maxOperations: number
  readonly maxOutputCodeUnits: number
  readonly maxIssues: number
}
const limitations = Object.freeze([
  'Checks cover the retained terminal cell projection and its emitted encoding, not pixel geometry, font ink or terminal emulator behavior.',
  'Identity and membership checks use native declarations; they do not establish complete correspondence with every authored family model.',
  'Declared route bundles, perpendicular crossings and numeric marks may share cells; composition diagnostics distinguish rejected content from those intentional overlaps.',
  'Directional owned-ink connectivity is checked only for explicitly connected native routes; other families retain endpoint and marker checks without a complete route proof.',
  'A passing cell contract does not certify aesthetic spacing, contrast or the legibility of a particular display.',
])
const identityKeys = new WeakMap<Pick<TerminalOwner, 'id' | 'kind'>, string>()
const keyOf = (owner: Pick<TerminalOwner, 'id' | 'kind'>) => {
  let key = identityKeys.get(owner)
  if (key === undefined) {
    key = JSON.stringify([owner.kind ?? 'node', owner.id])
    identityKeys.set(owner, key)
  }
  return key
}
const siteOf = (x: number, y: number) => `${x},${y}`

function liveOwnedMask(document: TerminalDocument, owner: TerminalOwner, x: number, y: number, visit: () => void): number {
  visit() // one translated point predicate; two neighbor bits are one mask predicate
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) return 0
  const cell = document.cell(x, y)
  if (!cell || !cell.glyph.trim() || cell.width !== 1) return 0
  let owned = false,
    ownMask = 0
  for (let index = 0; index < cell.owners.length; index++) {
    visit()
    if (keyOf(cell.owners[index]!) === keyOf(owner)) {
      owned = true
      ownMask = terminalOwnedStrokeMask(cell, index)
    }
  }
  if (!owned) return 0
  return cell.kind === 'stroke' ? ownMask : cell.kind === 'marker' ? (cell.marker?.direction === 'L' || cell.marker?.direction === 'R' ? 10 : cell.marker?.direction === 'T' || cell.marker?.direction === 'B' ? 5 : 0) : 0
}

/** Certify final native cells without rerendering, inferring boxes or lowering a pixel Scene. */
export function certifyTerminalLayout(document: TerminalDocument | undefined, output: string, colorMode: ColorMode, limits: TerminalCertificationLimits = TERMINAL_CERTIFICATION_LIMITS): TerminalLayoutCertification {
  for (const name of ['maxOperations', 'maxOutputCodeUnits', 'maxIssues'] as const) if (!Number.isSafeInteger(limits[name]) || limits[name] < 0 || limits[name] > TERMINAL_CERTIFICATION_LIMITS[name]) throw new RangeError(`Terminal certification ${name} must be within its bounded default.`)
  const coverage = { cells: 0, graphemes: 0, ownedCells: 0, unownedCells: 0, textAllocations: 0, textClusters: 0, identities: 0, ports: 0, markerContracts: 0 }
  const issues: TerminalLayoutCertificationIssue[] = []
  const projections: Array<Readonly<{ feature: string; message: string }>> = []
  const issueKeys = new Set<string>()
  let operations = 0,
    exhausted = false,
    issuesTruncated = false,
    projectionsTruncated = false,
    status: TerminalCertificationStatus = 'passed'
  const add = (code: string, issueStatus: Exclude<TerminalCertificationStatus, 'passed'>, message: string, elementId?: string, x?: number, y?: number) => {
    if (issueStatus === 'failed' || status === 'passed') status = issueStatus
    const issueKey = JSON.stringify([code, elementId ?? null])
    if (issueKeys.has(issueKey)) return
    issueKeys.add(issueKey)
    if (issues.length >= limits.maxIssues) {
      issuesTruncated = true
      return
    }
    issues.push(Object.freeze({ code, status: issueStatus, message, ...(elementId === undefined ? {} : { elementId }), ...(x === undefined || y === undefined ? {} : { cell: Object.freeze({ column: x, row: y }) }) }))
  }
  const budgetExceeded = Symbol('terminal certification budget')
  const visit = () => {
    if (operations >= limits.maxOperations) {
      exhausted = true
      throw budgetExceeded
    }
    operations++
  }
  let outputDigest: string | undefined
  if (output.length > limits.maxOutputCodeUnits) {
    exhausted = true
    add('TERMINAL_CERTIFICATION_LIMIT', 'unverified', 'The final encoded output exceeds the bounded certification scan.')
  } else outputDigest = renderContractDigest(output)
  let bounds: TerminalLayoutCertification['bounds']
  if (!document) add('TERMINAL_DOCUMENT_UNAVAILABLE', 'unverified', 'This renderer returned text without a retained native cell document.')
  else if (!exhausted)
    try {
      if (document.hasTerminalPathWitnessState?.()) visit() // newly added witness iterator before evidence allocation
      const evidence = document.layoutEvidence()
      bounds = Object.freeze({ width: evidence.width, height: evidence.height })
      const widths = evidence.emittedWidths
      if (!widths || evidence.emittedText === undefined || evidence.colorMode === undefined) {
        add('TERMINAL_EMISSION_UNAVAILABLE', 'unverified', 'The native document has no current final serialization evidence.')
      } else {
        const secured = evidence.colorMode === 'html' ? secureTerminalHtmlOutput(evidence.emittedText) : evidence.emittedText
        if (evidence.colorMode !== colorMode || secured !== output) add('TERMINAL_OUTPUT_MISMATCH', 'failed', "The returned bytes do not match this native document's final encoding.")
        const plain = terminalOutputPlainText(output, colorMode)
        const lines = widths.length === 0 && plain === '' ? [] : plain.split('\n')
        if (lines.length !== widths.length) add('TERMINAL_OUTPUT_ROWS', 'failed', 'The emitted row count differs from the native cell projection.')
        for (let y = 0; y < widths.length; y++) {
          visit()
          const width = widths[y]!
          if (!Number.isSafeInteger(width) || width < 0 || width > evidence.width) {
            add('TERMINAL_OUTPUT_EXTENT', 'failed', 'An emitted row has invalid cell bounds.', undefined, 0, y)
            continue
          }
          let expected = ''
          for (let x = 0; x < width; x++) {
            visit()
            const glyph = document.cell(x, y)?.glyph ?? ' '
            if (glyph !== WIDE_CHAR_CONTINUATION) expected += glyph
          }
          if (lines[y] !== expected) add('TERMINAL_OUTPUT_CELLS', 'failed', 'The emitted text differs from the retained final cells.', undefined, 0, y)
        }
      }
      const owners = new Map<string, TerminalOwner>(),
        byId = new Map<string, TerminalOwner[]>()
      for (const owner of evidence.owners) {
        visit()
        coverage.identities++
        owners.set(keyOf(owner), owner)
        const identities = byId.get(owner.id) ?? []
        identities.push(owner)
        byId.set(owner.id, identities)
      }
      for (const owner of owners.values()) {
        visit()
        if (owner.parent) {
          const parent = owners.get(keyOf(owner.parent))
          if (!parent) add('TERMINAL_PARENT_UNAVAILABLE', 'unverified', 'A native parent reference has no retained identity declaration.', owner.id)
          else if (
            parent.members &&
            !parent.members.some(member => {
              visit()
              return member === owner.id
            })
          )
            add('TERMINAL_MEMBERSHIP_MISMATCH', 'failed', 'The declared native parent does not include its child in its explicit membership.', owner.id)
        }
        if (owner.annotationTarget) {
          visit()
          if (!owners.has(keyOf(owner.annotationTarget))) add('TERMINAL_ANNOTATION_TARGET_UNAVAILABLE', 'unverified', 'A native annotation target reference has no retained identity declaration.', owner.id)
        }
        const members = new Set<string>()
        for (const member of owner.members ?? []) {
          visit()
          if (members.has(member)) add('TERMINAL_MEMBERSHIP_DUPLICATE', 'failed', `Native member ${member} is declared more than once.`, owner.id)
          members.add(member)
          const candidates = byId.get(member)
          if (!candidates?.length) add('TERMINAL_MEMBER_UNAVAILABLE', 'unverified', `Native member ${member} has no retained identity declaration.`, owner.id)
          else if (
            candidates.every(child => {
              visit()
              return child.parent && keyOf(child.parent) !== keyOf(owner)
            })
          )
            add('TERMINAL_MEMBERSHIP_MISMATCH', 'failed', `Native member ${member} declares a different parent.`, owner.id)
        }
        for (const endpoint of [owner.from, owner.to])
          if (endpoint !== undefined) {
            visit()
            if (!byId.has(endpoint)) add('TERMINAL_ENDPOINT_UNAVAILABLE', 'unverified', `Native endpoint ${endpoint} has no retained identity declaration.`, owner.id)
          }
      }
      const frames = new Map<string, { x: number; y: number; width: number; height: number }>()
      for (const [owner, bounds] of evidence.declarations) {
        visit()
        frames.set(keyOf(owner), bounds)
      }
      type Witness = { admission: NonNullable<ReturnType<typeof terminalPathAdmission>>; dx: number; dy: number; start?: TerminalPort; end?: TerminalPort; valid: boolean; starts: number; ends: number }
      let candidates: Map<string, Witness | null> | undefined
      // Registration/overlay work is charged once in this same final operation budget.
      for (let count = 0; count < evidence.pathWitnessWork + evidence.strokeProvenanceWork; count++) visit()
      if (evidence.pathWitnesses) {
        visit()
        candidates = new Map() // candidate-table capacity before allocation
        for (const descriptor of evidence.pathWitnesses!) {
          visit() // descriptor and runtime authority inspection
          if (!descriptor) continue
          const admission = terminalPathAdmission(descriptor.token),
            owner = owners.get(keyOf(descriptor.owner))
          if (!admission || !owner || owner.route !== 'connected' || owner.id !== admission.owner.id || owner.from !== admission.owner.from || owner.to !== admission.owner.to) continue
          visit() // translated extent predicate
          const { dx, dy } = descriptor
          if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy) || !Number.isSafeInteger(dx + admission.width) || !Number.isSafeInteger(dy + admission.height) || dx < 0 || dy < 0) continue
          const key = keyOf(owner)
          if (candidates.has(key)) {
            candidates.set(key, null)
            continue
          }
          visit()
          visit() // candidate record and map slot, before allocation
          candidates.set(key, { admission, dx, dy, valid: true, starts: 0, ends: 0 })
        }
        if (candidates.size) {
          for (let header = 0; header < 9; header++) visit() // evidence object, iterators and generator factories/objects before allocation
          for (const [owner, port] of document.layoutEvidence().ports) {
            visit() // exact live-port binding before deciding whether a cell Map is needed
            const candidate = candidates.get(keyOf(owner))
            if (!candidate) continue
            const expected = port.end === 'start' ? candidate.admission.route.source : candidate.admission.route.target
            if (port.end !== expected.end || port.nodeId !== expected.nodeId || port.side !== expected.side || port.x !== expected.x + candidate.dx || port.y !== expected.y + candidate.dy || port.markerProjection || port.boundary?.id !== expected.boundary?.id || port.boundary?.kind !== expected.boundary?.kind)
              candidate.valid = false
            if (port.end === 'start') {
              candidate.starts++
              candidate.start = port
            } else {
              candidate.ends++
              candidate.end = port
            }
          }
        }
      }
      const connected = new Map<string, { owner: TerminalOwner; ports: TerminalPort[]; cells?: Map<string, number>; witness?: Witness }>()
      for (const owner of owners.values()) {
        visit()
        if (owner.route === 'connected') {
          const candidate = candidates?.get(keyOf(owner)),
            witness = candidate?.valid && candidate.starts === 1 && candidate.ends === 1 ? candidate : undefined
          if (witness) {
            visit()
            visit()
            visit()
          } // new connected record, ports array and map slot before allocation
          connected.set(keyOf(owner), witness ? { owner, ports: [], witness } : { owner, ports: [], cells: new Map() })
        }
      }
      const expectedText = new Set<string>()
      for (const allocation of evidence.textAllocations) {
        visit()
        coverage.textAllocations++
        const { text } = allocation
        for (const [row, clusters] of text.lines.entries())
          for (const cluster of clusters) {
            visit()
            coverage.textClusters++
            const x = allocation.x + cluster.x,
              y = allocation.y + row,
              cell = document.cell(x, y)
            expectedText.add(siteOf(x, y))
            if (widths && (y >= widths.length || x + cluster.width > widths[y]!)) add('TERMINAL_TEXT_OMITTED', 'failed', 'Retained measured text falls outside the emitted cell extent.', allocation.owners[0]?.id, x, y)
            else if (!cell || cell.kind !== 'text' || cell.glyph !== cluster.glyph || cell.width !== cluster.width || cell.head !== x) add('TERMINAL_TEXT_CHANGED', 'failed', 'Retained measured text does not survive in the final cells.', allocation.owners[0]?.id, x, y)
            else {
              const checkOwners = (expected: readonly TerminalOwner[]) => {
                for (const owner of expected) {
                  visit()
                  if (
                    !cell.owners.some(actual => {
                      visit()
                      return keyOf(actual) === keyOf(owner)
                    })
                  )
                    add('TERMINAL_TEXT_OWNER_CHANGED', 'failed', 'Measured text lost its native owner.', owner.id, x, y)
                }
              }
              checkOwners(allocation.owners)
              for (const attribution of allocation.attributions ?? []) {
                visit()
                const { bounds } = attribution
                if (x >= bounds.x && x + cluster.width <= bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height) checkOwners(attribution.owners)
              }
            }
          }
        for (const row of text.emptyRows) {
          visit()
          if (widths && allocation.y + row >= widths.length) add('TERMINAL_EMPTY_TEXT_ROW_OMITTED', 'unverified', 'An authored empty text row is not distinguishable in the emitted extent.', allocation.owners[0]?.id)
        }
      }
      for (const [x, y, cell] of document.entries()) {
        visit()
        coverage.cells++
        const visible = cell.kind === 'text' || cell.glyph.trim().length !== 0
        if (visible && widths && (y >= widths.length || x >= widths[y]!)) add('TERMINAL_CELL_OMITTED', 'failed', 'Visible native content lies outside the emitted cell extent.', cell.owners[0]?.id, x, y)
        if (cell.owners.length) coverage.ownedCells++
        else if (visible) {
          coverage.unownedCells++
          add('TERMINAL_CELL_OWNER_UNAVAILABLE', 'unverified', 'A visible cell has no native semantic ownership.', undefined, x, y)
        }
        const directionalStroke = cell.kind === 'stroke' && (cell.stroke?.mask ?? terminalCellConnections(cell)) !== 0
        let strokeUnion = 0
        for (let ownerIndex = 0; ownerIndex < cell.owners.length; ownerIndex++) {
          const owner = cell.owners[ownerIndex]!
          visit()
          const ownMask = cell.kind === 'stroke' ? terminalOwnedStrokeMask(cell, ownerIndex) : 0
          if (cell.kind === 'stroke') {
            strokeUnion |= ownMask
            if (!Number.isInteger(ownMask) || ownMask < 0 || ownMask > 15 || (directionalStroke && owner.kind === 'edge' && !ownMask)) add('TERMINAL_STROKE_PROVENANCE_CHANGED', 'failed', 'A visible route stroke lacks its original owner directions.', owner.id, x, y)
            if (directionalStroke && owner.kind === 'edge')
              for (let previous = 0; previous < ownerIndex; previous++) {
                visit()
                const other = cell.owners[previous]!
                if (other.kind !== 'edge' || (owner.bundle && owner.bundle === other.bundle)) continue
                const otherMask = terminalOwnedStrokeMask(cell, previous)
                if (!((ownMask === 10 && otherMask === 5) || (ownMask === 5 && otherMask === 10))) add('TERMINAL_ROUTE_OVERLAP', 'failed', 'Unbundled routes share directions or turn at an occupied route cell.', owner.id, x, y)
              }
          }
          const route = connected.get(keyOf(owner))
          if (route?.cells && cell.glyph.trim() && cell.width === 1) {
            const mask = cell.kind === 'stroke' ? ownMask : cell.kind === 'marker' ? (cell.marker?.direction === 'L' || cell.marker?.direction === 'R' ? 10 : cell.marker?.direction === 'T' || cell.marker?.direction === 'B' ? 5 : undefined) : undefined
            if (mask) route.cells.set(siteOf(x, y), mask)
          }
          if (!owners.has(keyOf(owner))) add('TERMINAL_CELL_OWNER_UNKNOWN', 'failed', 'A final cell names an undeclared identity.', owner.id, x, y)
          if (owner.parent && (['group', 'cluster', 'subgraph'].includes(owner.parent.kind) || owner.kind === 'compartment')) {
            const frame = frames.get(keyOf(owner.parent))
            if (frame && (x < frame.x || x >= frame.x + frame.width || y < frame.y || y >= frame.y + frame.height)) add('TERMINAL_PARENT_FRAME_BREACH', 'failed', 'Owned content escapes its independently allocated native container frame.', owner.id, x, y)
          }
        }
        if (cell.kind === 'stroke' && cell.owners.length && !terminalStrokeProvenanceMatches(cell, strokeUnion)) add('TERMINAL_STROKE_PROVENANCE_CHANGED', 'failed', 'Final stroke ink disagrees with its original owner contributions.', cell.owners[0]?.id, x, y)
        if (cell.glyph === WIDE_CHAR_CONTINUATION) {
          const head = document.cell(cell.head, y)
          if (!head || head.glyph === WIDE_CHAR_CONTINUATION || cell.head >= x || cell.head + cell.width <= x || head.width !== cell.width) add('TERMINAL_GRAPHEME_CONTINUATION', 'failed', 'A wide grapheme continuation has no complete head.', cell.owners[0]?.id, x, y)
          else if (
            head.kind !== cell.kind ||
            head.owners.length !== cell.owners.length ||
            head.owners.some(owner => {
              visit()
              return !cell.owners.some(candidate => {
                visit()
                return keyOf(candidate) === keyOf(owner)
              })
            })
          )
            add('TERMINAL_GRAPHEME_OWNER_SPLIT', 'failed', 'A wide grapheme has inconsistent semantic ownership across its cells.', head.owners[0]?.id, x, y)
          continue
        }
        coverage.graphemes++
        const expectedGlyph = terminalGlyphForPaint(cell)
        if (expectedGlyph !== undefined && cell.glyph !== expectedGlyph) add('TERMINAL_PRIMITIVE_GLYPH_CHANGED', 'failed', 'A final glyph disagrees with its retained typed stroke, marker or numeric mark.', cell.owners[0]?.id, x, y)
        if (cell.head !== x || cell.width !== visualWidth(cell.glyph) || cell.width < 1) add('TERMINAL_GRAPHEME_HEAD', 'failed', 'A final grapheme has inconsistent cell width or head coordinates.', cell.owners[0]?.id, x, y)
        for (let offset = 1; offset < cell.width; offset++) {
          visit()
          const continuation = document.cell(x + offset, y)
          if (continuation?.glyph !== WIDE_CHAR_CONTINUATION || continuation.head !== x || continuation.width !== cell.width) add('TERMINAL_GRAPHEME_SPLIT', 'failed', 'A wide grapheme has lost a protected continuation cell.', cell.owners[0]?.id, x, y)
        }
        if (cell.kind === 'text' && !expectedText.has(siteOf(x, y))) add('TERMINAL_TEXT_MEASUREMENT_UNAVAILABLE', 'unverified', 'A painted text cell has no retained measured allocation.', cell.owners[0]?.id, x, y)
      }
      for (const [owner, port] of evidence.ports) {
        visit()
        coverage.ports++
        connected.get(keyOf(owner))?.ports.push(port)
        if (port.markers) coverage.markerContracts++
        else add('TERMINAL_MARKER_CONTRACT_UNAVAILABLE', 'unverified', 'An endpoint has no independent native marker expectation.', owner.id, port.x, port.y)
        const endpoint = port.end === 'start' ? owner.from : owner.to
        if (endpoint !== undefined && endpoint !== port.nodeId) add('TERMINAL_PORT_ENDPOINT_MISMATCH', 'failed', 'The allocated port disagrees with the native endpoint identity.', owner.id, port.x, port.y)
        if (!byId.has(port.nodeId)) add('TERMINAL_PORT_TARGET_UNAVAILABLE', 'unverified', 'A port target has no retained identity declaration.', owner.id, port.x, port.y)
        if (port.boundary) {
          const boundaryKey = keyOf(port.boundary),
            seen = new Set<string>()
          let item = owners.get(keyOf({ id: port.nodeId, kind: 'node' })),
            ancestor = false
          while (item?.parent) {
            visit()
            const parentKey = keyOf(item.parent)
            if (seen.has(parentKey)) break
            seen.add(parentKey)
            if (parentKey === boundaryKey) {
              ancestor = true
              break
            }
            item = owners.get(parentKey)
          }
          if (!ancestor || !['group', 'cluster', 'subgraph'].includes(port.boundary.kind)) add('TERMINAL_PORT_BOUNDARY_MISMATCH', 'failed', 'The physical port boundary is not a declared container ancestor of its authored endpoint.', owner.id, port.x, port.y)
          const frame = frames.get(boundaryKey)
          if (!frame) add('TERMINAL_PORT_BOUNDARY_UNAVAILABLE', 'unverified', 'The physical port boundary has no allocated frame.', owner.id, port.x, port.y)
          else if (!port.markerProjection) {
            const horizontal = port.side === 'L' || port.side === 'R'
            const distance = port.side === 'L' ? frame.x - port.x : port.side === 'R' ? port.x - (frame.x + frame.width - 1) : port.side === 'T' ? frame.y - port.y : port.y - (frame.y + frame.height - 1)
            const along = horizontal ? port.y - frame.y : port.x - frame.x
            if (!port.side || distance < 0 || distance > 1 || along < 0 || along >= (horizontal ? frame.height : frame.width)) add('TERMINAL_PORT_BOUNDARY_CONTACT', 'failed', 'The physical port does not touch its declared container face.', owner.id, port.x, port.y)
          }
        }
      }
      for (const { owner, ports, cells, witness } of connected.values()) {
        visit()
        if (ports.length === 2 && ports.every(port => port.markerProjection && port.markerProjection === ports[0]!.markerProjection)) continue
        const start = witness ? witness.start : ports.find(port => port.end === 'start'),
          end = witness ? witness.end : ports.find(port => port.end === 'end')
        for (const port of ports) {
          visit()
          const physical = port.boundary ?? { id: port.nodeId, kind: 'node' as const },
            physicalKey = keyOf(physical)
          const frame = frames.get(physicalKey),
            mask = witness ? liveOwnedMask(document, owner, port.x, port.y, visit) : (cells!.get(siteOf(port.x, port.y)) ?? 0)
          const dx = port.side === 'R' ? 1 : port.side === 'L' ? -1 : 0,
            dy = port.side === 'B' ? 1 : port.side === 'T' ? -1 : 0
          const inward = port.side === 'T' ? 4 : port.side === 'R' ? 8 : port.side === 'B' ? 1 : port.side === 'L' ? 2 : 0
          const distance = !frame ? -1 : dx ? (dx > 0 ? port.x - (frame.x + frame.width - 1) : frame.x - port.x) : dy > 0 ? port.y - (frame.y + frame.height - 1) : frame.y - port.y
          const contact = distance < 0 || distance > 1 ? undefined : document.cell(port.x - dx * distance, port.y - dy * distance)
          if (
            !frame ||
            !(mask & inward) ||
            !contact?.glyph.trim() ||
            (contact.kind !== 'stroke' && contact.kind !== 'marker') ||
            !contact.owners.some(candidate => {
              visit()
              return keyOf(candidate) === physicalKey
            })
          )
            add('TERMINAL_ROUTE_CONTACT_FAILED', 'failed', 'A connected route lacks visible owned connector and surface ink at its declared physical face.', owner.id, port.x, port.y)
        }
        let bfsCells = cells
        if (witness) {
          const points = witness.admission.route.points
          let valid = ports.length === 2 && !!start && !!end && points.length > 0
          for (let index = 0; index < points.length; index++) {
            const point = points[index]!,
              previous = points[index - 1],
              next = points[index + 1]
            let required = 0
            if (previous) required |= previous.x > point.x ? 2 : previous.x < point.x ? 8 : previous.y > point.y ? 4 : 1
            if (next) required |= next.x > point.x ? 2 : next.x < point.x ? 8 : next.y > point.y ? 4 : 1
            const mask = liveOwnedMask(document, owner, point.x + witness.dx, point.y + witness.dy, visit)
            if (!mask || (mask & required) !== required) valid = false
          }
          if (valid) continue
          // The path is a sufficient witness, not an exact-plan requirement.
          // A later same-owner alternative may still connect the actual ports.
          // Rebuild only this owner's live mask map, charging the SAME budget.
          visit()
          bfsCells = new Map() // fallback map capacity before allocation
          for (const [x, y] of document.entries()) {
            const mask = liveOwnedMask(document, owner, x, y, visit)
            if (mask) {
              visit()
              visit()
              bfsCells.set(siteOf(x, y), mask)
            } // key and map slot before allocation
          }
        }
        const first = start && siteOf(start.x, start.y),
          last = end && siteOf(end.x, end.y)
        const queue = first && bfsCells!.has(first) ? [first] : [],
          seen = new Set(queue)
        for (let index = 0; index < queue.length && !seen.has(last ?? ''); index++) {
          visit()
          const here = queue[index]!,
            [x, y] = here.split(',').map(Number),
            mask = bfsCells!.get(here)!
          for (const [dx, dy, bit, opposite] of [
            [0, -1, 1, 4],
            [1, 0, 2, 8],
            [0, 1, 4, 1],
            [-1, 0, 8, 2],
          ] as const) {
            visit()
            const next = siteOf(x! + dx, y! + dy)
            if (mask & bit && (bfsCells!.get(next) ?? 0) & opposite && !seen.has(next)) {
              seen.add(next)
              queue.push(next)
            }
          }
        }
        if (ports.length !== 2 || !first || !last || !seen.has(last)) add('TERMINAL_ROUTE_DISCONNECTED', 'failed', 'Declared connected ports have no complete path through mutually connected visible owned stroke and marker cells.', owner.id, start?.x, start?.y)
      }
      try {
        document.assertMarkers(visit)
      } catch (error) {
        if (error === budgetExceeded) throw error
        add('TERMINAL_MARKER_CONTRACT_FAILED', 'failed', error instanceof Error ? error.message : 'Final native marker admission failed.')
      }
      for (const diagnostic of document.diagnostics) {
        visit()
        if (['TERMINAL_TEXT_COLLISION', 'TERMINAL_ROUTE_OVERLAP', 'TERMINAL_GEOMETRY_COLLISION'].includes(diagnostic.code)) add(diagnostic.code, 'failed', diagnostic.message, diagnostic.feature, diagnostic.cell?.column, diagnostic.cell?.row)
        else if (diagnostic.code === 'TERMINAL_OWNERSHIP_UNAVAILABLE') add(diagnostic.code, 'unverified', diagnostic.message, diagnostic.feature)
        else if (diagnostic.code === 'TERMINAL_FAMILY_PROJECTION') {
          if (projections.length < limits.maxIssues) projections.push(Object.freeze({ feature: diagnostic.feature, message: diagnostic.message }))
          else projectionsTruncated = true
        }
      }
    } catch (error) {
      if (error !== budgetExceeded) throw error
      add('TERMINAL_CERTIFICATION_LIMIT', 'unverified', 'The final native cell inspection exhausted its operation budget.')
    }
  return Object.freeze({
    version: 1,
    unit: 'cell',
    scope: 'terminal-cells',
    status,
    ...(outputDigest === undefined ? {} : { outputDigest }),
    ...(bounds ? { bounds } : {}),
    coverage: Object.freeze(coverage),
    budget: Object.freeze({ operations, maxOperations: limits.maxOperations, outputCodeUnits: output.length, maxOutputCodeUnits: limits.maxOutputCodeUnits, exhausted, issuesTruncated, projectionsTruncated }),
    issues: Object.freeze(issues),
    projections: Object.freeze(projections),
    limitations,
  })
}
