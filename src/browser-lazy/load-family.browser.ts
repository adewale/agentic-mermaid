import type { FamilyDescriptor } from '../agent/families.ts'
import type { renderLoadedFamilySvgWithReceipt } from './render-core.ts'

/** The owning async build co-locates the renderer export with each family. */
export async function loadRenderingFamily(loader: () => Promise<{ default: FamilyDescriptor }>) {
  return await loader() as { default: FamilyDescriptor; renderLoadedFamilySvgWithReceipt: typeof renderLoadedFamilySvgWithReceipt }
}
