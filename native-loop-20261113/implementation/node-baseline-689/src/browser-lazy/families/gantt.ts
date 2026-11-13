import descriptorData from '../generated/descriptors/gantt.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { GANTT_SVG_HOOKS } from '../../svg-family-hooks/gantt.ts'

export default createBrowserFamilyDescriptor(descriptorData, GANTT_SVG_HOOKS)
