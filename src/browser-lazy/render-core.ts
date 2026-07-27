import type { FamilyDescriptor } from '../agent/families.ts'
import { installLoadedFamilyDescriptor } from '../agent/family-router.ts'
import { executeGraphicalRequest } from '../graphical-render.ts'
import type { RenderOptions } from '../types.ts'

export function renderLoadedFamilySvg(
  source: string,
  options: RenderOptions,
  family: FamilyDescriptor,
): string {
  installLoadedFamilyDescriptor(family)
  return executeGraphicalRequest(source, options, 'svg', undefined, {
    expectedFamilyId: family.id,
    familyDescriptor: family,
  }).svg
}
