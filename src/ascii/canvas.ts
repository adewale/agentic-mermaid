import type { Canvas, DrawingCoord } from './types.ts'
import { TerminalDocument } from './terminal-document.ts'
import { graphemes } from '../shared/graphemes.ts'
import { visualWidth } from './width.ts'

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
  if (forceOverwrite) { canvas.text(start.x, start.y, text, { role: 'text' }); return }
  let x = start.x
  let run = '', runStart = x
  const flush = (): void => { if (run) canvas.text(runStart, start.y, run, { role: 'text' }); run = '' }
  for (const glyph of graphemes(text)) {
    const width = visualWidth(glyph)
    if (width === 0) continue
    if (Array.from({ length: width }, (_, offset) => canvas.get(x + offset, start.y)).every(cell => cell === ' ')) {
      if (!run) runStart = x
      run += glyph
    } else flush()
    x += width
  }
  flush()
}
export function setCanvasSizeToGrid(canvas: Canvas, columns: Map<number, number>, rows: Map<number, number>): void {
  canvas.resize([...columns.values()].reduce((a, b) => a + b, 0), [...rows.values()].reduce((a, b) => a + b, 0))
}
