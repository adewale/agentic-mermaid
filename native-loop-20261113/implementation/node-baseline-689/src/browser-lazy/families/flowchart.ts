import descriptorData from '../generated/descriptors/flowchart.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { FLOWCHART_SVG_HOOKS } from '../../svg-family-hooks/flowchart.ts'

export default createBrowserFamilyDescriptor(descriptorData, FLOWCHART_SVG_HOOKS)
