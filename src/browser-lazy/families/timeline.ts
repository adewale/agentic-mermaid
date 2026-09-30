import descriptorData from '../generated/descriptors/timeline.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { TIMELINE_SVG_HOOKS } from '../../svg-family-hooks/timeline.ts'

export default createBrowserFamilyDescriptor(descriptorData, TIMELINE_SVG_HOOKS)
