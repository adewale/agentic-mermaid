import type { DrawingFactory } from './drawing.ts'
import type { LabelContent } from '../shared/display-text.ts'

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

type Sink<T> = (input: SequenceLineInput) => T | undefined
const sinks = new WeakMap<object, Sink<unknown>>()

/** Lookup cannot observe a custom factory's properties or accessors. */
export function sequenceLineSinkOf<T>(factory: DrawingFactory<T>): Sink<T> | undefined {
  return sinks.get(factory) as Sink<T> | undefined
}

/** Native drawing installs only on its fresh factory during the closed operation. */
export function installSequenceLineSink<T>(factory: DrawingFactory<T>, sink: Sink<T>): () => void {
  sinks.set(factory, sink)
  return () => { sinks.delete(factory) }
}
