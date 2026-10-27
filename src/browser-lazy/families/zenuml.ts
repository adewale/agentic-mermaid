import descriptorData from '../generated/descriptors/zenuml.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { ZENUML_SVG_HOOKS } from '../../svg-family-hooks/zenuml.ts'
export default createBrowserFamilyDescriptor(descriptorData, ZENUML_SVG_HOOKS)
