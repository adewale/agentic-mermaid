import descriptorData from '../generated/descriptors/state.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { STATE_SVG_HOOKS } from '../../svg-family-hooks/state.ts'

export default createBrowserFamilyDescriptor(descriptorData, STATE_SVG_HOOKS)
