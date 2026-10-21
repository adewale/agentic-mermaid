import type { PositionedDiagram, RenderContext } from '../types.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
import * as marks from './marks.ts'

/** One lowering program, with a consumer selected before any marks are built. */
export interface DrawingDocument<T> extends Omit<SceneDoc, 'parts'> { parts: T[] }
export type DrawingFactory<T> = {
  [K in 'shape' | 'text' | 'connector' | 'documentOpen' | 'documentContent' | 'documentText' | 'definitions' | 'documentClose']: (...args: Parameters<typeof marks[K]>) => T
} & {
  group(fields: Omit<Parameters<typeof marks.group>[0], 'children'> & { children: Array<{ node: T; indent: number }> }): T
  pathArtwork(fields: Parameters<typeof marks.pathArtwork>[0]): T
}
export type DrawingProducer<P extends PositionedDiagram = PositionedDiagram> = <T>(factory: DrawingFactory<T>, context: RenderContext<P>) => DrawingDocument<T>
const nativeDrawings = new WeakMap<object, DrawingProducer>()

export function sceneLowering<P extends PositionedDiagram>(draw: DrawingProducer<P>): (context: RenderContext<P>) => SceneDoc {
  const lower = (context: RenderContext<P>): SceneDoc => draw<SceneNode>(marks, context)
  nativeDrawings.set(lower, draw as DrawingProducer)
  return lower
}

/** Keep the private native capability when adapting a typed built-in hook. */
export function inheritNativeDrawing<T extends object>(source: object, target: T): T {
  const drawing = nativeDrawings.get(source)
  if (drawing) nativeDrawings.set(target, drawing)
  return target
}
export function nativeDrawingOf(lower: object | undefined): DrawingProducer | undefined {
  return lower && nativeDrawings.get(lower)
}
