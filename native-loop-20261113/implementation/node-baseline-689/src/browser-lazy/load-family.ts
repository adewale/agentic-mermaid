import type { FamilyDescriptor } from '../agent/families.ts'

/** Canonical source/isolated consumers acquire the descriptor and renderer. */
export async function loadRenderingFamily(loader: () => Promise<{ default: FamilyDescriptor }>) {
  const [family, core] = await Promise.all([loader(), import('./render-core.ts')])
  return { ...family, renderLoadedFamilySvgWithReceipt: core.renderLoadedFamilySvgWithReceipt }
}
