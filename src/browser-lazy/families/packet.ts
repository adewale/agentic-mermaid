import descriptorData from '../generated/descriptors/packet.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { PACKET_SVG_HOOKS } from '../../svg-family-hooks/packet.ts'

export default createBrowserFamilyDescriptor(descriptorData, PACKET_SVG_HOOKS)
