import type {
  FamilyDescriptor,
  FamilyLayoutResult,
} from '../agent/families.ts'
import type { PositionedDiagram, RenderContext } from '../types.ts'

export type BrowserSvgFamilyHooks = Pick<
  FamilyDescriptor,
  'normalizeRequest' | 'layout' | 'lowerScene'
>

type BrowserFamilyDescriptorData = Omit<
  FamilyDescriptor,
  keyof BrowserSvgFamilyHooks | 'contractVersion' | 'capabilityEvidence'
>

export function scene<TPositioned extends PositionedDiagram>(
  lowerer: (ctx: RenderContext<TPositioned>) => ReturnType<NonNullable<FamilyDescriptor['lowerScene']>>,
): NonNullable<FamilyDescriptor['lowerScene']> {
  return ctx => lowerer(ctx as RenderContext<TPositioned>)
}

export function layoutResult<TPositioned extends PositionedDiagram>(
  positioned: TPositioned,
  extra: Omit<FamilyLayoutResult<TPositioned>, 'positioned'> = {},
): FamilyLayoutResult<TPositioned> {
  return { positioned, ...extra }
}

/** Assemble the SVG-only descriptor loaded by the async browser entry.
 * Agent, ASCII, and positioned-layout hooks deliberately stay out of these
 * chunks; the synchronous entry remains the complete API. */
export function createBrowserFamilyDescriptor(
  data: BrowserFamilyDescriptorData,
  hooks: BrowserSvgFamilyHooks,
): FamilyDescriptor {
  return Object.freeze({
    ...data,
    ...hooks,
    contractVersion: 2,
    capabilityEvidence: Object.freeze([]),
  })
}
