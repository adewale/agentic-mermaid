import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import { lowerSequenceDrawing } from '../sequence/renderer.ts'
import type { PositionedSequenceDiagram } from '../sequence/types.ts'
import type { RenderContext } from '../types.ts'

/** Preserve the native drawing capability while naming ZenUML's owned Scene. */
function lowerZenUmlDrawing<T>(marks: DrawingFactory<T>, context: RenderContext<PositionedSequenceDiagram>): DrawingDocument<T> {
  return { ...lowerSequenceDrawing(marks, context), family: 'zenuml' }
}
export const lowerZenUmlScene = sceneLowering<PositionedSequenceDiagram>(lowerZenUmlDrawing)
