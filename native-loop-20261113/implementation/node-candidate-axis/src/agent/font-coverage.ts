// Node-only font discovery for explicitly caller-supplied directories.
// Bundled resources enter through verified byte snapshots instead; this module
// must never scan the package font directory as an implicit source of truth.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  findUncoveredScriptsFromBuffers,
  type UncoveredScript,
} from './font-coverage-core.ts'

const FONT_EXT = /\.(ttf|otf|ttc|otc)$/i

function fontFilesUnder(directory: string, depth = 4): string[] {
  if (depth < 0) return []
  let entries: string[]
  try {
    entries = readdirSync(directory).sort()
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry)
    try {
      const stat = statSync(path)
      if (stat.isDirectory()) files.push(...fontFilesUnder(path, depth - 1))
      else if (FONT_EXT.test(entry)) files.push(path)
    } catch {
      // A missing or unreadable caller file contributes no coverage.
    }
  }
  return files
}

function fontBuffersUnder(directories: readonly string[]): Uint8Array[] {
  const buffers: Uint8Array[] = []
  for (const directory of directories) {
    for (const file of fontFilesUnder(directory)) {
      try {
        buffers.push(new Uint8Array(readFileSync(file)))
      } catch {
        // A missing or unreadable caller file contributes no coverage.
      }
    }
  }
  return buffers
}

/**
 * Determine glyph coverage from the exact verified bundled buffers plus fonts
 * in directories the caller explicitly opted into.
 */
export function findUncoveredScripts(
  svg: string,
  callerFontDirectories: readonly string[],
  verifiedFontBuffers: readonly Uint8Array[],
): UncoveredScript[] {
  return findUncoveredScriptsFromBuffers(svg, [
    ...verifiedFontBuffers,
    ...fontBuffersUnder(callerFontDirectories),
  ])
}
