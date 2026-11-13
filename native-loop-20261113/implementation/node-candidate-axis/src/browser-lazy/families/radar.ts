import descriptorData from '../generated/descriptors/radar.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { RADAR_SVG_HOOKS } from '../../svg-family-hooks/radar.ts'

export default createBrowserFamilyDescriptor(descriptorData, RADAR_SVG_HOOKS)
