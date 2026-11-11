import descriptorData from '../generated/descriptors/agentflow.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { AGENTFLOW_SVG_HOOKS } from '../../svg-family-hooks/agentflow.ts'

export default createBrowserFamilyDescriptor(descriptorData, AGENTFLOW_SVG_HOOKS)
