import descriptorData from '../generated/descriptors/usecase.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { USECASE_SVG_HOOKS } from '../../svg-family-hooks/usecase.ts'

export default createBrowserFamilyDescriptor(descriptorData, USECASE_SVG_HOOKS)

export { renderLoadedFamilySvgWithReceipt } from '../render-core.ts'
