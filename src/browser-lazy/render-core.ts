import type { FamilyDescriptor } from '../agent/families.ts'
import { installLoadedFamilyDescriptor } from '../agent/family-router.ts'
import { prepareFamilyDrawingConsumer, executeFamilyRenderRequest } from './render-consumer.ts'
import type { HtmlEntityTableNotLoadedError } from '../shared/html-entity-table.ts'
import type { RenderOptions } from '../types.ts'
import type { GraphicalSvgArtifact } from '../graphical-render.ts'
import { captureRenderOptionsInput, captureRenderOptions, capturedRenderBackend, resolveRenderRequestForExecution, type ResolvedRenderRequest } from '../render-contract.ts'
import { deferredDependency } from '../layout/certification-error.ts'
import { measureRenderStage } from '../render-stages.ts'

export async function renderLoadedFamilySvg(
  source: string,
  options: RenderOptions,
  family: FamilyDescriptor,
): Promise<string> {
  return (await renderLoadedFamilySvgWithReceipt(source, options, family)).svg
}

export async function renderLoadedFamilySvgWithReceipt(
  source: string,
  options: RenderOptions,
  family: FamilyDescriptor,
): Promise<GraphicalSvgArtifact> {
  options = captureRenderOptionsInput(options)
  installLoadedFamilyDescriptor(family)
  let request: ResolvedRenderRequest | undefined
  const loaded = new Map<'ELK' | 'YAML' | 'Styles' | 'Agentic layout' | 'Trinity layout' | 'Trinity graph' | 'Forest layout' | 'HTML entities' | 'Bundled Inter metrics' | 'Layout optimization' | 'Authored parser positions', () => Promise<void>>()
  for (;;) {
    try {
      options = captureRenderOptions(options)
      const backend = capturedRenderBackend(options)
      const { consumer: drawingConsumer, ready } = prepareFamilyDrawingConsumer(backend, options, family)
      if (ready) await ready
      request ??= measureRenderStage('request', () => resolveRenderRequestForExecution(source, options, 'svg', undefined, {
        expectedFamilyId: family.id,
        familyDescriptor: family,
        ...(drawingConsumer ? { drawingConsumer } : {}),
      }))
      return await executeFamilyRenderRequest(request)
    } catch (error) {
      // Only the dependency demanded by this render is fetched. Replay the
      // admitted request so callbacks, options and host registrations retain
      // their original snapshot across each dependency await. Each named
      // provider may be demanded only once; another loader for the same name
      // cannot turn a failed replay into an unbounded retry.
      const deferred = deferredDependency(error)
      const load = deferred ? deferred.load
        : (error as Partial<HtmlEntityTableNotLoadedError> | undefined)?.loadHtmlEntityTable
      const dependency = deferred
        ? deferred.dependency === 'ELK' || deferred.dependency === 'YAML' || deferred.dependency === 'Styles' || deferred.dependency === 'Agentic layout' || deferred.dependency === 'Trinity layout' || deferred.dependency === 'Trinity graph' || deferred.dependency === 'Forest layout' || deferred.dependency === 'Bundled Inter metrics' || deferred.dependency === 'Layout optimization' || deferred.dependency === 'Authored parser positions' ? deferred.dependency : undefined
        : typeof load === 'function' ? 'HTML entities' : undefined
      if (!dependency || typeof load !== 'function' || loaded.has(dependency) || [...loaded.values()].includes(load)) throw error
      loaded.set(dependency, load)
      await load()
    }
  }
}
