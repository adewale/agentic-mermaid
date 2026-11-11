import descriptorData from '../generated/descriptors/venn.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { VENN_SVG_HOOKS } from '../../svg-family-hooks/venn.ts'

export default createBrowserFamilyDescriptor(descriptorData, VENN_SVG_HOOKS)

export { renderLoadedFamilySvgWithReceipt } from '../render-core.ts'
