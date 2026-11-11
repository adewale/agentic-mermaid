import descriptorData from '../generated/descriptors/treeview.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { TREEVIEW_SVG_HOOKS } from '../../svg-family-hooks/treeview.ts'

export default createBrowserFamilyDescriptor(descriptorData, TREEVIEW_SVG_HOOKS)

export { renderLoadedFamilySvgWithReceipt } from '../render-core.ts'
