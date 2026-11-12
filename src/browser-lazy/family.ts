import { enrollOwnedFamily } from '../experimental/owned-family.ts'
import { inheritNativeDrawing, adaptOwnedSceneLowering } from '../scene/drawing.ts'
import type { FamilyDescriptor, FamilyLayoutResult, FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import type { PositionedDiagram, RenderContext } from '../types.ts'

export type BrowserSvgFamilyHooks = Pick<FamilyDescriptor, 'normalizeRequest' | 'configDiagnostics' | 'statementEnds' | 'layout' | 'lowerScene'> & Required<Pick<FamilyDescriptor, 'projectPositioned'>>

export type BrowserTerminalFamilyHooks = Pick<FamilyDescriptor, 'normalizeRequest' | 'configDiagnostics' | 'statementEnds'> & Required<Pick<FamilyDescriptor, 'renderAscii'>>

type BrowserFamilyDescriptorData = Omit<FamilyDescriptor, keyof BrowserSvgFamilyHooks | 'contractVersion' | 'capabilityEvidence'>

export function positionedView<TPositioned extends PositionedDiagram>(projector: (ctx: FamilyPositionedProjectionContext<TPositioned>) => FamilyPositionedView): NonNullable<FamilyDescriptor['projectPositioned']> {
  return ctx => projector(ctx as FamilyPositionedProjectionContext<TPositioned>)
}

export function scene<TPositioned extends PositionedDiagram>(lowerer: (ctx: RenderContext<TPositioned>) => ReturnType<NonNullable<FamilyDescriptor['lowerScene']>>): NonNullable<FamilyDescriptor['lowerScene']> {
  return adaptOwnedSceneLowering(
    lowerer,
    inheritNativeDrawing(lowerer, ctx => lowerer(ctx as RenderContext<TPositioned>)),
  )
}

export function layoutResult<TPositioned extends PositionedDiagram>(positioned: TPositioned, extra: Omit<FamilyLayoutResult<TPositioned>, 'positioned'> = {}): FamilyLayoutResult<TPositioned> {
  return { positioned, ...extra }
}

/** Assemble a source-only output descriptor without agent editing hooks.
 * Graphical families retain their positioned view for final certification;
 * terminal families retain their native cell renderer. */
export function createBrowserFamilyDescriptor(data: BrowserFamilyDescriptorData, hooks: BrowserSvgFamilyHooks | BrowserTerminalFamilyHooks): FamilyDescriptor {
  const descriptor: FamilyDescriptor = Object.freeze({
    ...data,
    ...hooks,
    contractVersion: 2,
    capabilityEvidence: Object.freeze([]),
  })
  enrollOwnedFamily(descriptor)
  return descriptor
}
