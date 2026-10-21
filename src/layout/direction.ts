import type { Direction } from '../types.ts'

/** Shared Mermaid-to-ELK direction mapping, without depending on the graph engine. */
export function directionToElk(dir: Direction): string {
  switch (dir) {
    case 'LR': return 'RIGHT'
    case 'RL': return 'LEFT'
    case 'BT': return 'UP'
    case 'TD':
    case 'TB':
    default: return 'DOWN'
  }
}
