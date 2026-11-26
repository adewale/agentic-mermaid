import type { C4Body, C4Direction, C4Diagnostic } from './types.ts'
export interface C4Box { id: string; x: number; y: number; width: number; height: number; headerHeight?: number; container?: boolean; cylinder?: boolean; bottomPadding?: number }
/** Wider gaps the relationships between two elements need, applied only to
 * the gaps between those two elements. */
export interface C4Corridor { between: readonly [string, string]; gapX: number; gapY: number }
export interface C4PlacementOptions { gapX: number; gapY: number; padding: number; marginX: number; marginY: number; shapesPerRow: number; boundariesPerRow: number; direction: C4Direction; maxWidth?: number; corridors?: readonly C4Corridor[] }
/** Shared semantic ordering; callers independently supply pixel or cell extents. */
/** `corridorsClear` is false when a corridor's routes cannot stay between its
 * two elements: an element is nested below the level where the pair splits,
 * the pair is one element or an element and its ancestor, or another element
 * at that level lies between them. Those routes detour through gaps the
 * corridor does not widen. */
export function placeC4Boxes(body: C4Body, sizes: ReadonlyMap<string, C4Box>, options: C4PlacementOptions): { boxes: Map<string, C4Box>; width: number; height: number; diagnostics: C4Diagnostic[]; corridorsClear: boolean } {
  const boxes = new Map([...sizes].map(([id, box]) => [id, { ...box }])), diagnostics: C4Diagnostic[] = []
  const statementOrder = new Map(body.statements.map((statement, index) => [statement.id, index]))
  const all = [...body.boundaries, ...body.elements].sort((a, b) => (statementOrder.get(a.statementId) ?? 0) - (statementOrder.get(b.statementId) ?? 0)), parents = new Map(all.map(item => [item.id, item.parentId]))
  const hints = [...body.layout.hints, ...body.relationships.filter(item => item.direction).map(item => ({ from: item.from, to: item.to, direction: item.direction!, statementId: item.statementId }))]
  const immediate = (id: string, parent: string | undefined): string | undefined => {
    const seen = new Set<string>()
    while (parents.get(id) !== parent) { if (seen.has(id)) return undefined; seen.add(id); const next = parents.get(id); if (!next) return undefined; id = next }
    return id
  }
  const applied = new Set<C4Corridor>()
  let corridorsClear = true
  const arrange = (parent: string | undefined, visiting: Set<string>, availableWidth?: number): { width: number; height: number } => {
    const children = all.filter(item => item.parentId === parent && boxes.has(item.id))
    for (const child of children) if (boxes.get(child.id)!.container && !visiting.has(child.id)) {
      const next = new Set(visiting); next.add(child.id)
      const size = arrange(child.id, next, availableWidth === undefined ? undefined : Math.max(1, availableWidth - options.padding * 2)), box = boxes.get(child.id)!
      box.width = Math.max(box.width, size.width + options.padding * 2)
      box.height = Math.max(box.height, size.height + (box.headerHeight ?? 0) + options.padding + Math.max(options.padding, box.bottomPadding ?? 0))
    }
    let maxPerRow = children.some(child => boxes.get(child.id)!.container) ? options.boundariesPerRow : options.shapesPerRow
    const direction = options.direction, horizontal = direction === 'LR' || direction === 'RL'
    if (!horizontal && availableWidth !== undefined) {
      const widest = Math.max(1, ...children.map(child => boxes.get(child.id)!.width))
      const columns = Math.max(1, Math.floor((availableWidth + options.gapX) / (widest + options.gapX)))
      maxPerRow = Math.max(maxPerRow, Math.ceil(children.length / columns))
    }
    // A corridor widens only the gaps between its two elements: the gaps
    // between their rows (lanes) and, in the lanes from one to the other, the
    // gaps between their slots. Other gaps keep the base spacing.
    const corridors = (options.corridors ?? []).flatMap(corridor => {
      const a = immediate(corridor.between[0], parent), b = immediate(corridor.between[1], parent)
      if (!a || !b || a === b || !boxes.has(a) || !boxes.has(b)) return []
      applied.add(corridor)
      if (a !== corridor.between[0] || b !== corridor.between[1]) corridorsClear = false
      return [{ a, b, slot: horizontal ? corridor.gapX : corridor.gapY, lane: horizontal ? corridor.gapY : corridor.gapX }]
    })
    const slotBase = horizontal ? options.gapX : options.gapY, laneBase = horizontal ? options.gapY : options.gapX
    type Seats = Map<string, { lane: number; slot: number }>
    const laneGaps = new Map<number, number>(), slotGaps = new Map<string, number>()
    const widen = (seats: Seats) => {
      for (const corridor of corridors) {
        const a = seats.get(corridor.a)!, b = seats.get(corridor.b)!
        for (let lane = Math.min(a.lane, b.lane); lane < Math.max(a.lane, b.lane); lane++) laneGaps.set(lane, Math.max(laneGaps.get(lane) ?? laneBase, corridor.lane))
        for (let lane = Math.min(a.lane, b.lane); lane <= Math.max(a.lane, b.lane); lane++) for (let slot = Math.min(a.slot, b.slot); slot < Math.max(a.slot, b.slot); slot++) slotGaps.set(`${lane}:${slot}`, Math.max(slotGaps.get(`${lane}:${slot}`) ?? slotBase, corridor.slot))
      }
    }
    const pack = (): Seats => {
      const placed: Seats = new Map()
      let cursorX = 0, cursorY = 0, rowHeight = 0, columnWidth = 0, count = 0, lane = 0
      children.forEach(child => {
        const box = boxes.get(child.id)!
        if (count && (count >= maxPerRow || horizontal && availableWidth !== undefined && cursorX + box.width > availableWidth)) { const gap = laneGaps.get(lane) ?? laneBase; if (horizontal) { cursorX = 0; cursorY += rowHeight + gap; rowHeight = 0 } else { cursorY = 0; cursorX += columnWidth + gap; columnWidth = 0 }; count = 0; lane++ }
        box.x = cursorX; box.y = cursorY; placed.set(child.id, { lane, slot: count })
        const gap = slotGaps.get(`${lane}:${count}`) ?? slotBase
        if (horizontal) cursorX += box.width + gap; else cursorY += box.height + gap
        rowHeight = Math.max(rowHeight, box.height); columnWidth = Math.max(columnWidth, box.width); count++
      })
      return placed
    }
    // Seats come from packing with base gaps. A width budget can move a seat
    // once corridors widen its gaps, so widen the gaps between the new seats
    // too and repack until the seats settle. Gaps only ever widen.
    let seats = pack()
    for (let round = 0; corridors.length && round < 4; round++) {
      widen(seats)
      const next = pack(), settled = [...next].every(([id, seat]) => seats.get(id)!.lane === seat.lane && seats.get(id)!.slot === seat.slot)
      seats = next
      if (settled) break
    }
    // Explicit directional statements constrain separate axes, so mixed left/up
    // relations do not incorrectly reverse semantic arrows or disappear.
    const constraints: Array<{ before: string; after: string; axis: 'x' | 'y'; statementId: string }> = []
    for (const hint of hints) {
      const from = immediate(hint.from, parent), to = immediate(hint.to, parent)
      if (!from || !to || from === to || !boxes.has(from) || !boxes.has(to)) continue
      const axis = hint.direction === 'LR' || hint.direction === 'RL' ? 'x' : 'y'
      const reverse = hint.direction === 'RL' || hint.direction === 'BT'
      const before = reverse ? to : from, after = reverse ? from : to
      const reachable = (start: string, end: string, seen = new Set<string>()): boolean => start === end || (!seen.has(start) && (seen.add(start), constraints.some(c => c.axis === axis && c.before === start && reachable(c.after, end, seen))))
      if (reachable(after, before)) { diagnostics.push({ code: 'C4_LAYOUT_CONFLICT', severity: 'warning', statementId: hint.statementId, message: `Conflicting C4 ${axis === 'x' ? 'horizontal' : 'vertical'} direction for ${hint.from} and ${hint.to}; the earlier constraint is retained.` }); continue }
      constraints.push({ before, after, axis, statementId: hint.statementId })
    }
    if (constraints.length) {
      // Remove accidental opposite order from initial packing; constraints alone
      // determine the constrained axes before the non-overlap pass below.
      for (const child of children) { const box = boxes.get(child.id)!; if (constraints.some(c => c.axis === 'x' && (c.before === child.id || c.after === child.id))) box.x = 0; if (constraints.some(c => c.axis === 'y' && (c.before === child.id || c.after === child.id))) box.y = 0 }
      const gap = (a: string, b: string, axis: 'x' | 'y') => Math.max(axis === 'x' ? options.gapX : options.gapY, ...corridors.filter(c => c.a === a && c.b === b || c.a === b && c.b === a).map(c => (axis === 'x') === horizontal ? c.slot : c.lane))
      const propagate = () => { for (let pass = 0; pass < children.length; pass++) for (const c of constraints) { const a = boxes.get(c.before)!, b = boxes.get(c.after)!; b[c.axis] = Math.max(b[c.axis], a[c.axis] + ((c.axis === 'x' ? a.width : a.height) + gap(c.before, c.after, c.axis))) } }
      propagate()
      for (let pass = 0; pass < children.length; pass++) {
        let moved = false
        for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
          const a = boxes.get(children[i]!.id)!, b = boxes.get(children[j]!.id)!
          if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) { b.y = a.y + a.height + gap(children[i]!.id, children[j]!.id, 'y'); moved = true }
        }
        propagate(); if (!moved) break
      }
    } else if (direction === 'RL' || direction === 'BT') {
      const total = Math.max(0, ...children.map(child => { const box = boxes.get(child.id)!; return direction === 'RL' ? box.x + box.width : box.y + box.height }))
      for (const child of children) { const box = boxes.get(child.id)!; if (direction === 'RL') box.x = total - box.x - box.width; else box.y = total - box.y - box.height }
    }
    for (const corridor of corridors) {
      const a = boxes.get(corridor.a)!, b = boxes.get(corridor.b)!
      const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x + a.width, b.x + b.width), y1 = Math.max(a.y + a.height, b.y + b.height)
      if (children.some(child => { const box = boxes.get(child.id)!; return child.id !== corridor.a && child.id !== corridor.b && box.x < x1 && box.x + box.width > x0 && box.y < y1 && box.y + box.height > y0 })) corridorsClear = false
    }
    return { width: Math.max(0, ...children.map(child => { const b = boxes.get(child.id)!; return b.x + b.width })), height: Math.max(0, ...children.map(child => { const b = boxes.get(child.id)!; return b.y + b.height })) }
  }
  const extent = arrange(undefined, new Set(), options.maxWidth === undefined ? undefined : Math.max(1, options.maxWidth - options.marginX * 2))
  const absolute = (parent: string | undefined, x: number, y: number, seen: Set<string>) => {
    for (const child of all.filter(item => item.parentId === parent)) { const box = boxes.get(child.id); if (!box || seen.has(child.id)) continue; seen.add(child.id); box.x += x; box.y += y; if (box.container) absolute(child.id, box.x + options.padding, box.y + (box.headerHeight ?? 0) + options.padding, seen) }
  }
  absolute(undefined, options.marginX, options.marginY, new Set())
  if ((options.corridors ?? []).some(corridor => !applied.has(corridor))) corridorsClear = false
  return { boxes, width: extent.width + options.marginX * 2, height: extent.height + options.marginY * 2, diagnostics, corridorsClear }
}
