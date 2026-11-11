import descriptorData from '../generated/descriptors/swimlane.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { SWIMLANE_SVG_HOOKS } from '../../svg-family-hooks/swimlane.ts'

export default createBrowserFamilyDescriptor(descriptorData, SWIMLANE_SVG_HOOKS)

export { renderLoadedFamilySvgWithReceipt } from '../render-core.ts'
