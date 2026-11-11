import descriptorData from '../generated/descriptors/wardley.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { WARDLEY_SVG_HOOKS } from '../../svg-family-hooks/wardley.ts'
export default createBrowserFamilyDescriptor(descriptorData, WARDLEY_SVG_HOOKS)

export { renderLoadedFamilySvgWithReceipt } from '../render-core.ts'
