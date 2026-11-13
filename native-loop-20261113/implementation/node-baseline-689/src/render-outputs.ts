/** Closed first-party output vocabulary shared by render and negotiation. */
export const RENDER_OUTPUTS = Object.freeze(['svg', 'png', 'ascii', 'unicode', 'html', 'layout'] as const)
export type RenderOutput = typeof RENDER_OUTPUTS[number]
