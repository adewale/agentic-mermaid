import { tipAnchoredArrow } from '../scene/marker-resources.ts'
import { prepareMarkerTerminals } from '../scene/marker-terminals.ts'
export const requirementArrow = tipAnchoredArrow('requirement-arrow', { width: 9, height: 7 }, 'end', { fill: 'none', stroke: 'var(--_arrow)', strokeWidth: '1' }, 'userSpaceOnUse')
export const requirementMarkerTerminal = prepareMarkerTerminals([requirementArrow])
