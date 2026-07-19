export const DENSE_DAG_CASES = 2_000
export const DIAMOND_FAN_CASES = 800

const DIRECTIONS = ['LR', 'RL', 'TD', 'BT'] as const
const WORDS = [
  'warnings',
  'ok',
  'same word ok',
  'a longer label goes here',
  'x',
  'errors',
  'q',
  'done',
  'retry',
  'validate input',
] as const

const hash = (i: number) => Math.imul(i + 1, 2654435761) >>> 0
const bit = (i: number, b: number) => (hash(i) >>> (b & 31)) & 1
const shape = (id: string, text: string, kind: number) => [
  `${id}["${text}"]`,
  `${id}{${text}}`,
  `${id}((${text}))`,
  `${id}(["${text}"])`,
  `${id}[/"${text}"/]`,
  `${id}[(${text})]`,
  `${id}{{${text}}}`,
][kind % 7]

/** Dense multi-component DAGs with back-edges, high fan-out, mixed shapes,
 * variable-length links, and occasional self-loops. */
export function denseDag(seed: number): string {
  const direction = DIRECTIONS[seed % 4]
  const nodeCount = 5 + (hash(seed) % 8)
  const lines = [`flowchart ${direction}`]
  for (let i = 0; i < nodeCount; i++) {
    lines.push(`  ${shape(`N${i}`, WORDS[(seed + i) % WORDS.length]!, hash(seed + i) % 7)}`)
  }
  const edgeCount = 4 + (hash(seed >> 2) % 10)
  for (let i = 0; i < edgeCount; i++) {
    const source = hash(seed * 7 + i) % nodeCount
    const target = hash(seed * 13 + i + 1) % nodeCount
    if (source === target) {
      lines.push(`  N${source} --> N${source}`)
      continue
    }
    const arrow = ['-->', '===>', '--->', '---->'][hash(seed + i) % 4]
    const label = bit(seed + i, 5) ? `|${WORDS[(seed + i) % WORDS.length]!.replace(/[^a-z ]/g, '')}|` : ''
    lines.push(`  N${source} ${arrow}${label} N${target}`)
  }
  return lines.join('\n')
}

/** Extreme decision-diamond fans with reciprocal edges mixed in. */
export function diamondFan(seed: number): string {
  const direction = DIRECTIONS[seed % 4]
  const targetCount = 2 + (hash(seed) % 6)
  const lines = [`flowchart ${direction}`, `  D{${WORDS[seed % WORDS.length]}}`]
  for (let i = 0; i < targetCount; i++) {
    lines.push(`  D -->|${bit(seed + i, 4) ? 'yes' : 'no'}| T${i}["${WORDS[(seed + i) % WORDS.length]}"]`)
  }
  const sourceCount = 2 + (hash(seed >> 3) % 3)
  for (let i = 0; i < sourceCount; i++) {
    lines.push(`  S${i}["${WORDS[(seed + i) % WORDS.length]}"] --> D`)
  }
  if (bit(seed, 15)) lines.push('  T0 --> D')
  return lines.join('\n')
}

export const DEGENERATE_ROUTE_GENERATORS = [
  { name: 'denseDag', cases: DENSE_DAG_CASES, generate: denseDag },
  { name: 'diamondFan', cases: DIAMOND_FAN_CASES, generate: diamondFan },
] as const
