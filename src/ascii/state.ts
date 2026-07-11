import type { MermaidGraph, StateNoteSpec } from '../types.ts'
import type { AsciiConfig, AsciiGraph, AsciiTheme, CharRole, ColorMode } from './types.ts'
import { convertToAsciiGraph } from './converter.ts'
import { createMapping } from './grid.ts'
import { drawGraph, drawMultiBox } from './draw.ts'
import { wrapText } from './wrap.ts'
import { canvasToString, flipCanvasVertically, flipRoleCanvasVertically, getCanvasSize, increaseRoleCanvasSize, increaseSize, mkCanvas, mkRoleCanvas, setRole } from './canvas.ts'

interface Box { x: number; y: number; width: number; height: number }

/** Shared graph rendering plus State-only note geometry. */
export function renderStateAscii(parsed: MermaidGraph, config: AsciiConfig, colorMode: ColorMode, theme: AsciiTheme, targetWidth?: number): string {
  const graph = convertToAsciiGraph(parsed, config)
  createMapping(graph)
  drawGraph(graph)
  if (parsed.stateNotes?.length) overlayNotes(graph, parsed.stateNotes, targetWidth)
  if (parsed.direction === 'BT') {
    flipCanvasVertically(graph.canvas)
    flipRoleCanvasVertically(graph.roleCanvas)
  }
  return canvasToString(graph.canvas, { roleCanvas: graph.roleCanvas, colorMode, theme })
}

function overlayNotes(graph: AsciiGraph, notes: StateNoteSpec[], targetWidth?: number): void {
  const noteLineWidth = targetWidth === undefined ? undefined : Math.max(1, Math.floor(targetWidth / 2) - 4)
  const drawings = notes.map(note => ({
    note,
    canvas: drawMultiBox([
      note.text.split(/\r?\n/).flatMap(line => noteLineWidth ? wrapText(line, noteLineWidth) : [line]),
    ], graph.config.useAscii, 1),
  }))
  let shift = 0
  for (const { note, canvas } of drawings) {
    const target = boundsFor(graph, note.target)
    if (note.side === 'left' && target) shift = Math.max(shift, canvas.length + 2 - target.x)
  }
  if (shift > 0) shiftRight(graph, shift)

  const occupied: Box[] = graph.nodes.flatMap(node => node.drawingCoord && node.drawing ? [{
    x: node.drawingCoord.x, y: node.drawingCoord.y,
    width: node.drawing.length, height: node.drawing[0]?.length ?? 1,
  }] : [])
  const placed: Box[] = []
  for (const { note, canvas } of drawings) {
    const target = boundsFor(graph, note.target)
    if (!target) continue
    const [lastX, lastY] = getCanvasSize(canvas)
    const box: Box = {
      x: Math.max(0, note.side === 'right' ? target.x + target.width + 2 : target.x - lastX - 3),
      y: Math.max(0, target.y + Math.floor((target.height - lastY - 1) / 2)),
      width: lastX + 1,
      height: lastY + 1,
    }
    for (let guard = 0; guard <= occupied.length + placed.length; guard++) {
      const blockers = [...occupied, ...placed].filter(other => intersects(box, other))
      if (blockers.length === 0) break
      box.y = Math.max(...blockers.map(other => other.y + other.height + 1))
    }
    drawConnector(graph, target, box, note.side)
    copyDrawing(graph, canvas, box.x, box.y)
    placed.push(box)
  }
}

function boundsFor(graph: AsciiGraph, id: string): Box | undefined {
  const node = graph.nodes.find(candidate => candidate.name === id)
  if (node?.drawingCoord && node.drawing) return {
    x: node.drawingCoord.x, y: node.drawingCoord.y,
    width: node.drawing.length, height: node.drawing[0]?.length ?? 1,
  }
  const group = graph.subgraphs.find(candidate => candidate.id === id)
  return group ? {
    x: group.minX, y: group.minY,
    width: group.maxX - group.minX + 1, height: group.maxY - group.minY + 1,
  } : undefined
}

function shiftRight(graph: AsciiGraph, delta: number): void {
  const [lastX, lastY] = getCanvasSize(graph.canvas)
  const canvas = mkCanvas(lastX + delta, lastY)
  const roles = mkRoleCanvas(lastX + delta, lastY)
  for (let x = 0; x <= lastX; x++) for (let y = 0; y <= lastY; y++) {
    canvas[x + delta]![y] = graph.canvas[x]![y]!
    roles[x + delta]![y] = graph.roleCanvas[x]?.[y] ?? null
  }
  graph.canvas = canvas
  graph.roleCanvas = roles
  for (const node of graph.nodes) if (node.drawingCoord) node.drawingCoord.x += delta
  for (const group of graph.subgraphs) { group.minX += delta; group.maxX += delta }
  graph.offsetX += delta
}

function drawConnector(graph: AsciiGraph, target: Box, note: Box, side: StateNoteSpec['side']): void {
  const targetY = target.y + Math.floor(target.height / 2)
  const noteY = note.y + Math.floor(note.height / 2)
  const startX = side === 'right' ? target.x + target.width : target.x - 1
  const endX = side === 'right' ? note.x - 1 : note.x + note.width
  const horizontal = graph.config.useAscii ? '.' : '┄'
  const vertical = graph.config.useAscii ? ':' : '┆'
  for (let x = Math.min(startX, endX); x <= Math.max(startX, endX); x++) put(graph, x, targetY, horizontal, 'line', false)
  for (let y = Math.min(targetY, noteY); y <= Math.max(targetY, noteY); y++) put(graph, endX, y, vertical, 'line', false)
}

function copyDrawing(graph: AsciiGraph, canvas: string[][], ox: number, oy: number): void {
  const border = /^[+\-|┌┐└┘├┤─│]$/
  for (let x = 0; x < canvas.length; x++) for (let y = 0; y < (canvas[0]?.length ?? 0); y++) {
    const char = canvas[x]![y]!
    if (char !== ' ') put(graph, x + ox, y + oy, char, border.test(char) ? 'border' : 'text', true)
  }
}

function put(graph: AsciiGraph, x: number, y: number, char: string, role: CharRole, overwrite: boolean): void {
  if (x < 0 || y < 0) return
  increaseSize(graph.canvas, x, y)
  increaseRoleCanvasSize(graph.roleCanvas, x, y)
  if (!overwrite && graph.canvas[x]![y] !== ' ') return
  graph.canvas[x]![y] = char
  setRole(graph.roleCanvas, x, y, role)
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}
