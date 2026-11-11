import descriptorData from '../generated/descriptors/sankey.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { SANKEY_SVG_HOOKS } from '../../svg-family-hooks/sankey.ts'

export default createBrowserFamilyDescriptor(descriptorData, SANKEY_SVG_HOOKS)
