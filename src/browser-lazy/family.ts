import { enrollOwnedFamily } from '../experimental/owned-family.ts'
import { inheritNativeDrawing } from '../scene/drawing.ts'
import type {
  FamilyDescriptor,
  FamilyLayoutResult,
  FamilyPositionedProjectionContext,
  FamilyPositionedView,
} from '../agent/families.ts'
import type { PositionedDiagram, RenderContext } from '../types.ts'

export type BrowserSvgFamilyHooks = Pick<
  FamilyDescriptor,
  'normalizeRequest' | 'configDiagnostics' | 'statementEnds' | 'layout' | 'lowerScene'
> & Required<Pick<FamilyDescriptor, 'projectPositioned'>>

type BrowserFamilyDescriptorData = Omit<
  FamilyDescriptor,
  keyof BrowserSvgFamilyHooks | 'contractVersion' | 'capabilityEvidence'
>

export function positionedView<TPositioned extends PositionedDiagram>(
  projector: (ctx: FamilyPositionedProjectionContext<TPositioned>) => FamilyPositionedView,
): NonNullable<FamilyDescriptor['projectPositioned']> {
  return ctx => projector(ctx as FamilyPositionedProjectionContext<TPositioned>)
}

export function scene<TPositioned extends PositionedDiagram>(
  lowerer: (ctx: RenderContext<TPositioned>) => ReturnType<NonNullable<FamilyDescriptor['lowerScene']>>,
): NonNullable<FamilyDescriptor['lowerScene']> {
  return inheritNativeDrawing(lowerer, ctx => lowerer(ctx as RenderContext<TPositioned>))
}

export function layoutResult<TPositioned extends PositionedDiagram>(
  positioned: TPositioned,
  extra: Omit<FamilyLayoutResult<TPositioned>, 'positioned'> = {},
): FamilyLayoutResult<TPositioned> {
  return { positioned, ...extra }
}

/** Assemble the SVG-only descriptor loaded by the async browser entry.
 * Agent editing and ASCII stay out of these chunks. Each family retains its
 * pure positioned view so final geometry is certified before lowering. */
export function createBrowserFamilyDescriptor(
  data: BrowserFamilyDescriptorData,
  hooks: BrowserSvgFamilyHooks,
): FamilyDescriptor {
  const descriptor: FamilyDescriptor = Object.freeze({
    ...data,
    ...hooks,
    contractVersion: 2,
    capabilityEvidence: Object.freeze([]),
  })
  enrollOwnedFamily(descriptor)
  return descriptor
}
