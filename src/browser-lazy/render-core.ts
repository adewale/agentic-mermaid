import type { FamilyDescriptor } from '../agent/families.ts'
import { installLoadedFamilyDescriptor } from '../agent/family-router.ts'
import { executeGraphicalRequest } from '../graphical-render.ts'
import type { HtmlEntityTableNotLoadedError } from '../shared/html-entity-table.ts'
import type { RenderOptions } from '../types.ts'
import type { GraphicalSvgArtifact } from '../graphical-render.ts'
import { captureRenderOptions, capturedRenderBackend } from '../render-contract.ts'

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
  const render = () => executeGraphicalRequest(source, options, 'svg', undefined, {
    expectedFamilyId: family.id,
    familyDescriptor: family,
  })
  try {
    return render()
  } catch (error) {
    // The HTML5 entity table (~23 KB gzip) arrives only when a diagram
    // displays a named code beyond XML's five (`#hearts;`, not `#amp;`).
    // Rendering is deterministic, so render again once it has loaded.
    const load = (error as Partial<HtmlEntityTableNotLoadedError> | undefined)?.loadHtmlEntityTable
    if (typeof load !== 'function') throw error
    await load()
    return render()
  }
}
