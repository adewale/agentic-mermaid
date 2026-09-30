import descriptorData from '../generated/descriptors/journey.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { JOURNEY_SVG_HOOKS } from '../../svg-family-hooks/journey.ts'

export default createBrowserFamilyDescriptor(descriptorData, JOURNEY_SVG_HOOKS)
