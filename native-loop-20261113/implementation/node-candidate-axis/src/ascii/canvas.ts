import type { Canvas, DrawingCoord } from './types.ts'
import { TerminalDocument, measuredText } from './terminal-document.ts'

/** Legacy dimensions are inclusive; the document itself uses width/height. */
export function mkCanvas(x: number, y: number): Canvas {
  return new TerminalDocument(Math.max(0, x + 1), Math.max(0, y + 1))
}
export function copyCanvas(source: Canvas): Canvas { return source.blank() }
export function getCanvasSize(canvas: Canvas): [number, number] { return [canvas.width - 1, canvas.height - 1] }
export function increaseSize(canvas: Canvas, x: number, y: number): Canvas { canvas.resize(x + 1, y + 1); return canvas }

export function mergeCanvases(base: Canvas, offset: DrawingCoord, _useAscii: boolean, ...overlays: Canvas[]): Canvas {
  for (const overlay of overlays) base.overlay(overlay, offset.x, offset.y)
  return base
}
export function flipCanvasVertically(canvas: Canvas): Canvas { canvas.flip(false, true); return canvas }

export function drawText(canvas: Canvas, start: DrawingCoord, text: string, forceOverwrite = false): void {
  const label = measuredText(text)
  if (!forceOverwrite) for (let row = 0; row < label.height; row++) {
    for (let column = 0; column < label.width; column++) if (canvas.get(start.x + column, start.y + row) !== ' ') return
  }
  canvas.textBlock(start.x, start.y, label, { role: 'text' })
}
export function setCanvasSizeToGrid(canvas: Canvas, columns: Map<number, number>, rows: Map<number, number>): void {
  canvas.resize([...columns.values()].reduce((a, b) => a + b, 0), [...rows.values()].reduce((a, b) => a + b, 0))
}
