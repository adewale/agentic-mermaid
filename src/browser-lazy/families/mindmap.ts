import descriptorData from '../generated/descriptors/mindmap.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { MINDMAP_SVG_HOOKS } from '../../svg-family-hooks/mindmap.ts'

export default createBrowserFamilyDescriptor(descriptorData, MINDMAP_SVG_HOOKS)
