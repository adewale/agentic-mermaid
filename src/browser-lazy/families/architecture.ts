import descriptorData from '../generated/descriptors/architecture.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { ARCHITECTURE_SVG_HOOKS } from '../../svg-family-hooks/architecture.ts'

export default createBrowserFamilyDescriptor(descriptorData, ARCHITECTURE_SVG_HOOKS)
