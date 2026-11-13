import { tipAnchoredArrow } from '../scene/marker-resources.ts'
import { prepareMarkerTerminals } from '../scene/marker-terminals.ts'

export const eventModelingArrow = tipAnchoredArrow('eventmodeling-arrow', { width: 8, height: 8 }, 'end', { fill: 'var(--_line)' }, 'userSpaceOnUse')
export const eventModelingTerminal = prepareMarkerTerminals([eventModelingArrow])
