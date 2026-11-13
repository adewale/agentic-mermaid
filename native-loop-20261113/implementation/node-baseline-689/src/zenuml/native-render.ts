import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { lowerSequenceDrawing } from '../sequence/renderer.ts'
import { sceneLowering } from '../scene/drawing.ts'
import type { DrawingFactory } from '../scene/drawing.ts'
import type { PositionedSequenceDiagram } from '../sequence/types.ts'
import type { ResolvedSequenceConfig } from '../sequence/config.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { RenderContext, RenderOptions } from '../types.ts'
import type { ZenUMLBody } from './native-types.ts'
import { projectZenUMLSequence } from './native-sequence.ts'

/** Zen owns authored semantics; Sequence owns measured interaction geometry. */
export function layoutZenUML(body: ZenUMLBody, options: RenderOptions = {}, styleFace?: Readonly<InternalStyleFace>, config: ResolvedSequenceConfig = {}): PositionedSequenceDiagram {
  return layoutSequenceDiagram(projectZenUMLSequence(body), options, config, styleFace)
}

export const lowerZenUMLScene = sceneLowering(<T>(marks: DrawingFactory<T>, context: RenderContext<PositionedSequenceDiagram>) => ({
  ...lowerSequenceDrawing(marks, context),
  family: 'zenuml',
}))
