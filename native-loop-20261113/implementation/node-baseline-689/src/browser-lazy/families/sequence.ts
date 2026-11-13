import descriptorData from '../generated/descriptors/sequence.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { SEQUENCE_SVG_HOOKS } from '../../svg-family-hooks/sequence.ts'

export default createBrowserFamilyDescriptor(descriptorData, SEQUENCE_SVG_HOOKS)
