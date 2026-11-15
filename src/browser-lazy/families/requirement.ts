import descriptorData from '../generated/descriptors/requirement.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { REQUIREMENT_SVG_HOOKS } from '../../svg-family-hooks/requirement.ts'

export default createBrowserFamilyDescriptor(descriptorData, REQUIREMENT_SVG_HOOKS)
