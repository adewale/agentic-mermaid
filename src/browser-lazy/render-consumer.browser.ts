import type { FamilyDrawingPreparation } from './render-consumer.ts'
import type { FamilyDescriptor } from '../agent/families.ts'
import type { RenderOptions } from '../types.ts'
import type { ResolvedRenderRequest } from '../render-contract.ts'
import { executeResolvedSourceGraphicalRequest } from '../graphical-render.ts'
import { loadSceneBackend } from './scene-backend.ts'
import { FIRST_PARTY_DRAWING_CONSUMER } from '../scene/default-drawing-consumer.ts'
import { isOwnedFamily } from '../experimental/owned-family.ts'
import { nativeDrawingOf, originalNativeDrawingOf, preferSceneDrawing } from '../scene/drawing.ts'
import { sceneAssertionsEnabled } from '../scene/assertions.ts'

/** Only the source-only async graph can select the first-party write owner. */
export function prepareFamilyDrawingConsumer(backend: string, options: RenderOptions, family: FamilyDescriptor): FamilyDrawingPreparation {
  const producer = nativeDrawingOf(family.lowerScene)
  const drawingConsumer = backend === 'default' && isOwnedFamily(family) && producer
    && producer === originalNativeDrawingOf(family.lowerScene) && !preferSceneDrawing(family.id)
    && !sceneAssertionsEnabled() && options.layoutSafety !== 'strict' ? FIRST_PARTY_DRAWING_CONSUMER : undefined
  return { consumer: drawingConsumer, ready: drawingConsumer ? undefined : (async () => {
    await loadSceneBackend()
    if (backend !== 'default') await import('../scene/builtin-backends.ts')
  })() }
}
export function executeFamilyRenderRequest(request: ResolvedRenderRequest) {
  return executeResolvedSourceGraphicalRequest(request, loadSceneBackend)
}
