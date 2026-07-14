import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve mutation ranges from paired source markers.
 *
 * Absolute line ranges silently drift when code is inserted above them. Keeping
 * the markers beside the behavior makes the executable scope move with it.
 */
export function markedMutationScopes(root, scopes) {
  return scopes.map(({ file, marker }) => {
    const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/)
    const startText = `// mutation-scope:${marker}:start`
    const endText = `// mutation-scope:${marker}:end`
    const starts = lines.flatMap((line, index) => line.trim() === startText ? [index] : [])
    const ends = lines.flatMap((line, index) => line.trim() === endText ? [index] : [])
    if (starts.length !== 1 || ends.length !== 1 || starts[0] + 1 >= ends[0]) {
      throw new Error(`${file}: expected exactly one ordered ${marker} mutation-scope marker pair`)
    }
    // Stryker ranges are one-based and inclusive. Exclude the marker comments.
    return `${file}:${starts[0] + 2}-${ends[0]}`
  })
}
