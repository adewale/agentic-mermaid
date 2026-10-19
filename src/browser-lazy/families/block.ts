import descriptorData from '../generated/descriptors/block.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { BLOCK_SVG_HOOKS } from '../../svg-family-hooks/block.ts'

export default createBrowserFamilyDescriptor(descriptorData, BLOCK_SVG_HOOKS)
