import descriptorData from '../generated/descriptors/state.ts'
import { createBrowserFamilyDescriptor } from '../family.ts'
import { STATE_SVG_HOOKS } from '../../svg-family-hooks/state.ts'

// Source normalization reads a stateDiagram's comments and block notes with
// the State scanner; the lazy build loads it from here (source-comments.lazy.ts).
export { scanStateComments } from '../../state/comment.ts'

export default createBrowserFamilyDescriptor(descriptorData, STATE_SVG_HOOKS)
