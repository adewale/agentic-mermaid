import descriptorData from '../generated/descriptors/pie.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { PIE_SVG_HOOKS } from '../../svg-family-hooks/pie.ts'

export default createBrowserFamilyDescriptor(descriptorData, PIE_SVG_HOOKS)
