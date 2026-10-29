import descriptorData from '../generated/descriptors/treemap.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { TREEMAP_SVG_HOOKS } from '../../svg-family-hooks/treemap.ts'

export default createBrowserFamilyDescriptor(descriptorData, TREEMAP_SVG_HOOKS)
