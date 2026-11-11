import descriptorData from '../generated/descriptors/kanban.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { KANBAN_SVG_HOOKS } from '../../svg-family-hooks/kanban.ts'

export default createBrowserFamilyDescriptor(descriptorData, KANBAN_SVG_HOOKS)
