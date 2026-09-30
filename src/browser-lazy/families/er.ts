import descriptorData from '../generated/descriptors/er.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { ER_SVG_HOOKS } from '../../svg-family-hooks/er.ts'

export default createBrowserFamilyDescriptor(descriptorData, ER_SVG_HOOKS)
