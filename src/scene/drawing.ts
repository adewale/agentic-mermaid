import type { PositionedDiagram, RenderContext } from '../types.ts'
import type { MarkerDescriptor, SceneDoc, SceneNode } from './ir.ts'
import type { LabelContent } from '../shared/display-text.ts'
import type { SequenceLineCompiler } from './sequence-line-command.ts'
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
export interface SequenceLineInput {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly strokeColor: string
  readonly strokeWidth: string
  readonly label: string
  readonly labelContent?: LabelContent
}
type SequenceLineSink<T> = (input: SequenceLineInput) => T | undefined
type SequenceLineCompilerFactory = (marker: MarkerDescriptor) => SequenceLineCompiler
const nativeDrawings = new WeakMap<object, DrawingProducer>()
const originalNativeDrawings = new WeakMap<object, DrawingProducer>()
const sequenceLineCompilers = new WeakMap<object, SequenceLineCompilerFactory | undefined>()
const sequenceLineSinks = new WeakMap<object, SequenceLineSink<unknown>>()

export function sceneLowering<P extends PositionedDiagram>(draw: DrawingProducer<P>, sequenceLineCompiler?: SequenceLineCompilerFactory): (context: RenderContext<P>) => SceneDoc {
  const lower = (context: RenderContext<P>): SceneDoc => draw<SceneNode>(marks, context)
  nativeDrawings.set(lower, draw as DrawingProducer)
  originalNativeDrawings.set(lower, draw as DrawingProducer)
  if (!sequenceLineCompilers.has(draw)) sequenceLineCompilers.set(draw, sequenceLineCompiler)
  return lower
}

/** Keep the private native capability when adapting a typed built-in hook. */
export function inheritNativeDrawing<T extends object>(source: object, target: T): T {
  const drawing = nativeDrawings.get(source)
  if (drawing) {
    nativeDrawings.set(target, drawing)
    if (!originalNativeDrawings.has(target)) originalNativeDrawings.set(target, drawing)
  }
  return target
}
export function nativeDrawingOf(lower: object | undefined): DrawingProducer | undefined {
  return lower && nativeDrawings.get(lower)
}

/** Later capability inheritance cannot rewrite the originally installed producer. */
export function originalNativeDrawingOf(lower: object | undefined): DrawingProducer | undefined {
  return lower && originalNativeDrawings.get(lower)
}

/** Only an original private operation may consume this first-installed factory. */
export function sequenceLineCompilerOf(producer: object): SequenceLineCompilerFactory | undefined {
  return sequenceLineCompilers.get(producer)
}

/** Identity-only lookup adds no public/custom factory property observations. */
export function sequenceLineSinkOf<T>(factory: DrawingFactory<T>): SequenceLineSink<T> | undefined {
  return sequenceLineSinks.get(factory) as SequenceLineSink<T> | undefined
}

export function installSequenceLineSink<T>(factory: DrawingFactory<T>, sink: SequenceLineSink<T>): () => void {
  sequenceLineSinks.set(factory, sink)
  return () => { sequenceLineSinks.delete(factory) }
}
