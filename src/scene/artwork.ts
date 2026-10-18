import type { GroupMark, MarkPaint, SceneOwner, SceneTransform, SemanticChannels } from './ir.ts'
import { group, shape } from './marks.ts'
import { semanticChildId } from './identity.ts'

/** Lower bounded, source-owned icon paths without recovering geometry from SVG. */
export function pathArtwork(fields: {
  id: string
  paths: readonly string[]
  open: string
  paint: MarkPaint
  transform?: SceneTransform
  owner?: SceneOwner
  channels?: SemanticChannels
  join?: string
  indent?: number
  serializePath?: (path: string) => string
}): GroupMark {
  const serialize = fields.serializePath ?? (path => `<path d="${path}"/>`)
  return group({
    id: fields.id, role: 'icon', open: fields.open, close: '</g>',
    ...(fields.transform ? { transform: fields.transform } : {}),
    ...(fields.owner ? { owner: fields.owner } : {}),
    ...(fields.channels ? { channels: fields.channels } : {}),
    join: fields.join ?? '',
    children: fields.paths.map((path, index) => ({
      indent: fields.indent ?? 0,
      node: shape({ id: semanticChildId(fields.id, 'path', index), role: 'icon',
        geometry: { kind: 'path', d: path }, paint: fields.paint,
        ...(fields.owner ? { owner: fields.owner } : {}),
      }, serialize(path)),
    })),
  })
}
