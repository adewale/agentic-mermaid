// ============================================================================
// `direction TB|TD|BT|LR|RL` statement grammar — one copy, three consumers
// (class render parser, ER render parser, and any future family that adopts
// upstream's direction statement). The DIRECTION VALUES map to ELK through
// layout-engine's directionToElk, so statement parsing and direction→ELK
// mapping each live in exactly one place (P1/P6).
// ============================================================================

import type { Direction } from '../types.ts'

const DIRECTION_RE = /^direction\s+(TB|TD|BT|LR|RL)\s*$/i

/** Parse a `direction X` statement into a normalized Direction (undefined = not one). */
export function parseDirectionStatement(line: string): Direction | undefined {
  const m = line.match(DIRECTION_RE)
  return m ? (m[1]!.toUpperCase() as Direction) : undefined
}
