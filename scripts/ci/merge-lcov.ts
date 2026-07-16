import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

interface LineCoverage {
  count: number
  checksum?: string
}

function tracefilesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return tracefilesUnder(path)
    return entry.name === 'lcov.info' ? [path] : []
  })
}

export function mergeLcovTracefiles(tracefiles: readonly string[]): string {
  const sources = new Map<string, Map<number, LineCoverage>>()

  for (const tracefile of tracefiles) {
    let currentSource: string | undefined
    for (const record of readFileSync(tracefile, 'utf8').split(/\r?\n/)) {
      if (record.startsWith('SF:')) {
        currentSource = record.slice(3)
        if (!sources.has(currentSource)) sources.set(currentSource, new Map())
        continue
      }
      if (record === 'end_of_record') {
        currentSource = undefined
        continue
      }
      if (!record.startsWith('DA:')) continue
      if (!currentSource) throw new Error(`${tracefile}: DA record without an SF record`)

      const match = /^DA:(\d+),(\d+)(?:,(.+))?$/.exec(record)
      if (!match) throw new Error(`${tracefile}: malformed line record: ${record}`)
      const line = Number.parseInt(match[1]!, 10)
      const count = Number.parseInt(match[2]!, 10)
      const checksum = match[3]
      const lines = sources.get(currentSource)!
      const previous = lines.get(line)
      if (previous?.checksum && checksum && previous.checksum !== checksum) {
        throw new Error(`${currentSource}:${line}: conflicting LCOV checksums`)
      }
      lines.set(line, {
        count: (previous?.count ?? 0) + count,
        checksum: previous?.checksum ?? checksum,
      })
    }
  }

  const output: string[] = []
  for (const source of [...sources.keys()].sort()) {
    const lines = sources.get(source)!
    output.push('TN:', `SF:${source}`)
    for (const line of [...lines.keys()].sort((a, b) => a - b)) {
      const { count, checksum } = lines.get(line)!
      output.push(`DA:${line},${count}${checksum ? `,${checksum}` : ''}`)
    }
    output.push(`LF:${lines.size}`, `LH:${[...lines.values()].filter(line => line.count > 0).length}`, 'end_of_record')
  }
  return `${output.join('\n')}\n`
}

if (import.meta.main) {
  const [inputDirectory = 'coverage-shards', outputPath = 'coverage/lcov.info', expectedCountRaw] = process.argv.slice(2)
  const tracefiles = tracefilesUnder(inputDirectory).sort()
  if (tracefiles.length === 0) throw new Error(`No lcov.info files found under ${inputDirectory}`)
  if (expectedCountRaw !== undefined) {
    const expectedCount = Number.parseInt(expectedCountRaw, 10)
    if (!Number.isInteger(expectedCount) || expectedCount < 1) {
      throw new Error(`Expected LCOV shard count must be a positive integer, got ${JSON.stringify(expectedCountRaw)}`)
    }
    if (tracefiles.length !== expectedCount) {
      throw new Error(`Expected ${expectedCount} LCOV shards, found ${tracefiles.length}`)
    }
  }
  const merged = mergeLcovTracefiles(tracefiles)
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, merged)
  process.stdout.write(`Merged ${tracefiles.length} LCOV shards into ${outputPath}\n`)
}
