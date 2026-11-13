import type { FamilyDescriptor } from '../agent/families.ts'
import type { RenderOptions } from '../types.ts'
import type { FirstPartyDrawingConsumer } from '../scene/default-drawing-consumer.ts'

/** An own-slot preparation record never assimilates the private consumer. */
export interface FamilyDrawingPreparation {
  readonly consumer: FirstPartyDrawingConsumer | undefined
  readonly ready: Promise<unknown> | undefined
}

/** Source/SDK/isolated consumers keep the canonical synchronous Scene owner. */
export function prepareFamilyDrawingConsumer(backend: string, _options: RenderOptions, _family: FamilyDescriptor): FamilyDrawingPreparation {
  return { consumer: undefined, ready: backend === 'default' ? undefined : import('../scene/builtin-backends.ts') }
}
export { executeResolvedGraphicalRequest as executeFamilyRenderRequest } from '../graphical-render.ts'
