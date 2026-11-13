import descriptorData from '../generated/descriptors/railroad.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { RAILROAD_SVG_HOOKS } from '../../svg-family-hooks/railroad.ts'

export default createBrowserFamilyDescriptor(descriptorData, RAILROAD_SVG_HOOKS)
