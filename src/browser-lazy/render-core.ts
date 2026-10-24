import type { FamilyDescriptor } from '../agent/families.ts'
import { installLoadedFamilyDescriptor } from '../agent/family-router.ts'
import { executeResolvedGraphicalRequest } from '../graphical-render.ts'
import type { HtmlEntityTableNotLoadedError } from '../shared/html-entity-table.ts'
import type { RenderOptions } from '../types.ts'
import type { GraphicalSvgArtifact } from '../graphical-render.ts'
import { captureRenderOptions, capturedRenderBackend, resolveRenderRequestForExecution, type ResolvedRenderRequest } from '../render-contract.ts'
import { DeferredDependencyError } from '../layout/certification-error.ts'
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
  const loaded = new Set<() => Promise<void>>()
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
      // their original snapshot across either dependency await.
      const load = error instanceof DeferredDependencyError ? error.load
        : (error as Partial<HtmlEntityTableNotLoadedError> | undefined)?.loadHtmlEntityTable
      if (typeof load !== 'function' || loaded.has(load) || loaded.size >= 3) throw error
      loaded.add(load)
      await load()
    }
  }
}
