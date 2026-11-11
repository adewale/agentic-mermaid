import descriptorData from '../generated/descriptors/gitgraph.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { GITGRAPH_SVG_HOOKS } from '../../svg-family-hooks/gitgraph.ts'

export default createBrowserFamilyDescriptor(descriptorData, GITGRAPH_SVG_HOOKS)
