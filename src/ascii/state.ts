import { resolveLabelContent } from '../shared/display-text.ts'
import { terminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'
import type { MermaidGraph, StateNoteSpec } from '../types.ts'
import { Left, Right, type AsciiConfig, type AsciiGraph, type AsciiNode, type AsciiSubgraph, type AsciiTheme, type ColorMode, type GridCoord } from './types.ts'
import { convertToAsciiGraph } from './converter.ts'
import { createMapping } from './grid.ts'
import { drawGraph, drawMultiBox } from './draw.ts'
import { wrapText } from './wrap.ts'
import { displayText } from '../multiline-utils.ts'
import { flipCanvasVertically } from './canvas.ts'
import { getPath } from './pathfinder.ts'
import { allocateTerminalRoute, paintTerminalRoute } from './terminal-route.ts'
import type { TerminalDocument, TerminalOwner } from './terminal-document.ts'

interface Box { x: number; y: number; width: number; height: number }
interface NoteTarget { box: Box; kind: 'node' | 'cluster'; frames: AsciiSubgraph[] }

/** Shared graph rendering plus State-only note geometry. */
export function renderStateTerminal(parsed: MermaidGraph, config: AsciiConfig, colorMode: ColorMode, theme: AsciiTheme, targetWidth?: number): TerminalArtifact {
  const graph = convertToAsciiGraph(parsed, config, 'cluster')
  createMapping(graph)
  drawGraph(graph)
  if (parsed.stateNotes?.length) overlayNotes(graph, parsed.stateNotes, targetWidth ?? config.maxWidth)
  if (parsed.direction === 'BT') {
    flipCanvasVertically(graph.canvas)
  }
  return terminalArtifact(graph.canvas, { colorMode, theme })
}

function overlayNotes(graph: AsciiGraph, notes: StateNoteSpec[], targetWidth?: number): void {
  const noteLineWidth = targetWidth === undefined ? undefined : Math.max(1, Math.floor(targetWidth / 2) - 4)
  const drawings = notes.map(note => ({
    note,
    canvas: drawMultiBox([
      displayText(resolveLabelContent(note.text, note.textContent)).split(/\r?\n/).flatMap(line => noteLineWidth ? wrapText(line, noteLineWidth) : [line]),
    ], graph.config.useAscii, 1),
  }))
  let shift = 0
  for (const { note, canvas } of drawings) {
    const target = targetFor(graph, note.target)
    if (note.side === 'left' && target) shift = Math.max(shift, canvas.width + 2 - envelope(target).x)
  }
  if (shift > 0) shiftRight(graph, shift)

  const cards = graph.nodes.flatMap(node => { const box = nodeBounds(node); return box ? [box] : [] })
  const occupied: Box[] = [...cards]
  occupied.push(...graph.subgraphs.filter(group => !group.concurrencyRegion).map(groupBounds))
  // Retain the admitted graph as immutable background while planning and
  // drawing annotations. This layer is composed once, without repairing ink.
  const background = graph.canvas, layer = background.blank()
  const ink = [...background.entries()]
  const placed: Box[] = []
  const footprints: Box[] = []
  const plans = []
  for (const { note, canvas } of drawings) {
    const target = targetFor(graph, note.target)
    if (!target) continue
    const exterior = envelope(target)
    const box: Box = {
      x: note.side === 'right' ? exterior.x + exterior.width + 2 : exterior.x - canvas.width - 2,
      y: Math.max(0, target.box.y + Math.floor((target.box.height - canvas.height) / 2)),
      width: canvas.width,
      height: canvas.height,
    }
    const footprint = noteFootprint(box, note.side)
    const candidates = new Set([box.y, ...[...occupied, ...footprints].map(other => other.y + other.height + 1),
      ...ink.filter(([x]) => x >= footprint.x && x < footprint.x + footprint.width).map(([, y]) => y + 2)])
    box.y = [...candidates].filter(y => y >= box.y).sort((a, b) => a - b).find(y => {
      const candidate = { ...footprint, y }
      return ![...occupied, ...footprints].some(other => intersects(candidate, other)) && !ink.some(([x, y]) => contains(candidate, x, y))
    })!
    layer.scope({ id: note.id, kind: 'node', annotationTarget: { id: note.target, kind: target.kind } }, () => layer.overlay(canvas, box.x, box.y))
    plans.push({ note, target, box })
    placed.push(box)
    footprints.push(noteFootprint(box, note.side))
  }
  const demands = new Map<string, number>()
  const bundleFor = (note: StateNoteSpec, target: NoteTarget) => JSON.stringify(['state-note', target.kind, note.target, note.side])
  for (const { note, target } of plans) { const key = bundleFor(note, target); demands.set(key, (demands.get(key) ?? 0) + 1) }
  const approaches = plans.map(({ note, box }) => ({ x: note.side === 'right' ? box.x - 1 : box.x + box.width, y: box.y + Math.floor(box.height / 2) }))
  for (const [index, { note, target, box }] of plans.entries()) {
    const key = bundleFor(note, target)
    const link: TerminalOwner = { id: `${note.id}:link`, kind: 'edge', from: note.target, to: note.id, ...((demands.get(key) ?? 0) > 1 ? { bundle: key } : {}) }
    attachNote(background, layer, graph, cards, target, box, placed, approaches.filter((_, other) => index !== other), note.side, link)
  }
  graph.canvas.overlay(layer)
}

/** Allocate the note and its attachment face together. Opposing notes cannot
 * consume the same exterior approach cell before either route is planned. */
function noteFootprint(box: Box, side: StateNoteSpec['side']): Box {
  return { ...box, x: box.x - (side === 'right' ? 1 : 0), width: box.width + 1 }
}

function groupBounds(group: AsciiSubgraph): Box {
  return {
    x: group.minX, y: group.minY,
    width: group.maxX - group.minX + 1, height: group.maxY - group.minY + 1,
  }
}

function targetFor(graph: AsciiGraph, id: string): NoteTarget | undefined {
  const group = graph.subgraphs.find(candidate => candidate.id === id && !candidate.concurrencyRegion)
  if (group) {
    const frames: AsciiSubgraph[] = []
    for (let parent: AsciiSubgraph | null = group; parent; parent = parent.parent) if (!parent.concurrencyRegion) frames.push(parent)
    return { box: groupBounds(group), kind: 'cluster', frames }
  }
  const node = graph.nodes.find(candidate => candidate.name === id && !candidate.containerAnchor)
  const box = node && nodeBounds(node)
  return box ? {
    box,
    kind: 'node', frames: graph.subgraphs.filter(group => !group.concurrencyRegion && group.nodes.includes(node)),
  } : undefined
}

function nodeBounds(node: AsciiNode): Box | undefined {
  return !node.containerAnchor && node.drawingCoord && node.drawing ? { x: node.drawingCoord.x, y: node.drawingCoord.y, width: node.drawing.width, height: node.drawing.height ?? 1 } : undefined
}

function envelope(target: NoteTarget): Box {
  const boxes = [target.box, ...target.frames.map(groupBounds)]
  const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y))
  return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y }
}

function shiftRight(graph: AsciiGraph, delta: number): void {
  const canvas = graph.canvas.blank()
  canvas.overlay(graph.canvas, delta, 0)
  graph.canvas = canvas
  for (const node of graph.nodes) if (node.drawingCoord) node.drawingCoord.x += delta
  for (const group of graph.subgraphs) { group.minX += delta; group.maxX += delta }
  graph.offsetX += delta
}

function attachNote(background: TerminalDocument, layer: TerminalDocument, graph: AsciiGraph, cards: readonly Box[], target: NoteTarget, note: Box, noteBoxes: readonly Box[], reserved: readonly GridCoord[], side: StateNoteSpec['side'], owner: TerminalOwner): void {
  const right = side === 'right', dx = right ? 1 : -1
  const source = { nodeId: owner.from!, markers: [], end: 'start' as const, side: right ? 'R' as const : 'L' as const, x: right ? target.box.x + target.box.width - 1 : target.box.x, y: target.box.y + Math.floor(target.box.height / 2) }
  const destination = { nodeId: owner.to!, markers: [], end: 'end' as const, side: right ? 'L' as const : 'R' as const, x: right ? note.x : note.x + note.width - 1, y: note.y + Math.floor(note.height / 2) }
  const end = { x: destination.x - dx, y: destination.y }
  const frames = new Set(target.frames.filter(frame => target.kind !== 'cluster' || frame.id !== owner.from).map(frame => frame.id))
  const forbidden = [...cards]
  forbidden.push(...noteBoxes, ...graph.subgraphs.filter(frame => !frame.concurrencyRegion && !frames.has(frame.id)).map(groupBounds))
  forbidden.push(...reserved.map(point => ({ ...point, width: 1, height: 1 })))
  forbidden.push(...target.frames.filter(frame => frames.has(frame.id)).map(frame => ({ ...groupBounds(frame), height: displayText(frame.name).split('\n').length + 2 })))
  const free = (point: GridCoord): boolean => {
    if (point.x < 0 || point.y < 0 || forbidden.some(box => contains(box, point.x, point.y))) return false
    const cell = background.cell(point.x, point.y)
    return !cell || !!cell.stroke && cell.owners.length > 0 && cell.owners.every(element => element.kind === 'edge'
      || element.kind === 'cluster' && frames.has(element.id))
  }
  const canStep = (a: GridCoord, b: GridCoord): boolean => {
    const mask = a.x === b.x ? 5 : 10
    return [a, b].every(point => {
      if (!free(point)) return false
      const cell = background.cell(point.x, point.y), above = layer.cell(point.x, point.y)
      if (cell?.stroke && (cell.stroke.mask & mask)) return false
      return !above || !!above.stroke && above.owners.length > 0 && above.owners.every(element => element.kind === 'edge')
        && (!(above.stroke.mask & mask) || !!owner.bundle && above.owners.every(element => element.bundle === owner.bundle))
    })
  }
  const occupancy = { extent: { maxX: Math.max(background.width, layer.width), maxY: Math.max(background.height, layer.height) }, has: (key: string) => { const [x, y] = key.split(',').map(Number); return !free({ x: x!, y: y! }) } }
  const rows = new Set([source.y, ...Array.from({ length: Math.max(0, target.box.height - 2) }, (_, index) => target.box.y + index + 1)])
  for (const y of [...rows].sort((a, b) => Math.abs(a - source.y) - Math.abs(b - source.y) || a - b)) {
    const port = { ...source, y }, start = { x: source.x + dx, y }
    const endpoint = background.cell(port.x, port.y)
    if (endpoint?.kind !== 'stroke' || !endpoint.glyph.trim() || !endpoint.owners.some(element => element.kind === target.kind && element.id === owner.from)) continue
    const path = free(start) && free(end) ? getPath(occupancy, start, end, right ? Right : Left, canStep) : null
    if (!path || !path.every(free)) continue
    const route = allocateTerminalRoute(owner.id, port, destination, path)
    if (paintTerminalRoute(layer, route, owner, graph.config.useAscii, 'dotted')) return
    break
  }
  layer.report({ code: 'TERMINAL_GEOMETRY_COLLISION', feature: `state-note:${owner.to}`, cell: { column: source.x, row: source.y }, message: `No complete terminal attachment route could be allocated from ${owner.from} to ${owner.to}. The note remains visible without an attached connector.` })
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function contains(box: Box, x: number, y: number): boolean {
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
}

