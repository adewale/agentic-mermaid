import descriptorData from '../generated/descriptors/xychart.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { XYCHART_SVG_HOOKS } from '../../svg-family-hooks/xychart.ts'

export default createBrowserFamilyDescriptor(descriptorData, XYCHART_SVG_HOOKS)
