import type { FamilyDescriptor } from '../agent/families.ts'
import { installLoadedFamilyDescriptor } from '../agent/family-router.ts'
import { executeResolvedGraphicalRequest } from '../graphical-render.ts'
import type { HtmlEntityTableNotLoadedError } from '../shared/html-entity-table.ts'
import type { RenderOptions } from '../types.ts'
import type { GraphicalSvgArtifact } from '../graphical-render.ts'
import { captureRenderOptions, capturedRenderBackend, resolveRenderRequestForExecution, type ResolvedRenderRequest } from '../render-contract.ts'
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
  options = captureRenderOptions(options)
  if (capturedRenderBackend(options) !== 'default') await import('../scene/builtin-backends.ts')
  installLoadedFamilyDescriptor(family)
  let request: ResolvedRenderRequest | undefined
  const loaded = new Map<'ELK' | 'YAML' | 'Agentic layout' | 'Forest layout' | 'HTML entities', () => Promise<void>>()
  for (;;) {
    try {
      request ??= measureRenderStage('request', () => resolveRenderRequestForExecution(source, options, 'svg', undefined, {
        expectedFamilyId: family.id,
        familyDescriptor: family,
      }))
      return executeResolvedGraphicalRequest(request)
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
        ? deferred.dependency === 'ELK' || deferred.dependency === 'YAML' || deferred.dependency === 'Agentic layout' || deferred.dependency === 'Forest layout' ? deferred.dependency : undefined
        : typeof load === 'function' ? 'HTML entities' : undefined
      if (!dependency || typeof load !== 'function' || loaded.has(dependency) || [...loaded.values()].includes(load)) throw error
      loaded.set(dependency, load)
      await load()
    }
  }
}
