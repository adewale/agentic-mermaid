export type ResolvedSceneFeature = 'paint-server' | 'css' | 'geometry' | 'filter' | 'clip-path' | 'mask' | 'marker-mid' | 'nested-svg' | 'text-element' | 'marker' | 'scene-lowering' | 'ownership'

/** A resolved projection is atomic: unsupported ink never becomes a partial scene. */
export class ResolvedSceneError extends Error {
  readonly name = 'ResolvedSceneError'
  constructor(
    readonly code: 'RESOLVED_SCENE_UNSUPPORTED_ARTWORK' | 'RESOLVED_SCENE_UNAVAILABLE',
    readonly partId: string,
    readonly feature: ResolvedSceneFeature,
    message: string,
  ) { super(message) }
}
