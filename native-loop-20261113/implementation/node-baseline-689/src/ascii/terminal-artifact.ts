import type { TerminalInputModel } from './terminal-model.ts'
import type { AsciiContext } from '../agent/families.ts'
import type { TerminalDocument, TerminalSerializeOptions } from './terminal-document.ts'

/** Native geometry and its encoding policy travel together, before encoding. */
export interface TerminalArtifact {
  readonly document: TerminalDocument
  readonly serialization: Readonly<TerminalSerializeOptions>
}

export function terminalArtifact(document: TerminalDocument, serialization: TerminalSerializeOptions = {}): TerminalArtifact {
  return Object.freeze({ document, serialization: Object.freeze({ ...serialization }) })
}

export function serializeTerminalArtifact(artifact: TerminalArtifact): string {
  return artifact.document.serialize(artifact.serialization)
}

const nativeDrawing = Symbol('native terminal renderer')
type NativeRenderer = ((context: AsciiContext) => string) & {
  readonly [nativeDrawing]?: (context: AsciiContext, model?: TerminalInputModel) => TerminalArtifact
}

/** Preserve the string hook contract for callers and extensions. The common
 * native path calls the paired drawing function directly and encodes once.
 * A wrapper that returns only a string intentionally has no geometry claim. */
export function nativeTerminalRenderer(draw: (context: AsciiContext, model?: TerminalInputModel) => TerminalArtifact): (context: AsciiContext) => string {
  const renderer: NativeRenderer = context => serializeTerminalArtifact(draw(context))
  Object.defineProperty(renderer, nativeDrawing, { value: draw })
  return Object.freeze(renderer)
}

export function nativeTerminalArtifact(renderer: (context: AsciiContext) => string, context: AsciiContext, model?: TerminalInputModel): TerminalArtifact | undefined {
  return (renderer as NativeRenderer)[nativeDrawing]?.(context, model)
}
