import data from '../generated/descriptors/zenuml.ts'
import { ZENUML_SVG_HOOKS } from '../../svg-family-hooks/zenuml.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
export default createBrowserFamilyDescriptor(data, ZENUML_SVG_HOOKS)
