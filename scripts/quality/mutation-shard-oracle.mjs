#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { Instrumenter } from '@stryker-mutator/instrumenter'

const logger = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
}

function parseTarget(spec) {
  if (/[*?\[\]{}]/.test(spec)) throw new Error(`Mutation oracle requires concrete files, got ${spec}`)
  const match = /^(.*?)(?::(\d+)-(\d+))?$/.exec(spec)
  if (!match) throw new Error(`Expected a concrete whole-file or whole-line mutation target, got ${spec}`)
  return {
    file: match[1],
    range: match[2] ? {
      start: { line: Number(match[2]) - 1, column: 0 },
      end: { line: Number(match[3]) - 1, column: Number.MAX_SAFE_INTEGER },
    } : true,
  }
}

function repositoryPath(root, file) {
  return (isAbsolute(file) ? relative(root, file) : file).replaceAll('\\', '/')
}

function reportLocation(location) {
  return {
    start: { line: location.start.line + 1, column: location.start.column + 1 },
    end: { line: location.end.line + 1, column: location.end.column + 1 },
  }
}

function fingerprint(root, file, mutant, internalLocation = false) {
  const location = internalLocation ? reportLocation(mutant.location) : mutant.location
  return JSON.stringify([
    repositoryPath(root, file),
    location.start.line,
    location.start.column,
    location.end.line,
    location.end.column,
    mutant.mutatorName,
    mutant.replacement,
  ])
}

function addAll(multiset, root, mutants) {
  for (const mutant of mutants) {
    const key = fingerprint(root, mutant.fileName, mutant, true)
    multiset.set(key, (multiset.get(key) ?? 0) + 1)
  }
}

function addReported(multiset, root, reported) {
  for (const { file, mutant } of reported) {
    const key = fingerprint(root, file, mutant)
    multiset.set(key, (multiset.get(key) ?? 0) + 1)
  }
}

function multisetDelta(expected, actual) {
  let missing = 0
  let extra = 0
  for (const [key, count] of expected) missing += Math.max(0, count - (actual.get(key) ?? 0))
  for (const [key, count] of actual) extra += Math.max(0, count - (expected.get(key) ?? 0))
  return { missing, extra }
}

async function instrument(root, file, mutate, excludedMutations) {
  const absolute = join(root, file)
  const content = readFileSync(absolute, 'utf8')
  const result = await new Instrumenter(logger).instrument(
    [{ name: absolute, content, mutate }],
    { plugins: null, ignorers: [], excludedMutations, noHeader: true },
  )
  return result.mutants
}

async function instrumentTargets(root, specs, excludedMutations) {
  const byFile = new Map()
  for (const spec of specs) {
    const { file, range } = parseTarget(spec)
    const existing = byFile.get(file)
    if (range === true || existing === true) {
      if (existing && existing !== true) throw new Error(`${file}: cannot mix whole-file and ranged mutation targets`)
      byFile.set(file, true)
    } else {
      byFile.set(file, [...(existing ?? []), range])
    }
  }
  const mutants = []
  for (const [file, mutate] of byFile) mutants.push(...await instrument(root, file, mutate, excludedMutations))
  return mutants
}

const payload = JSON.parse(readFileSync(0, 'utf8'))
const results = []
for (const lane of payload.lanes) {
  const expected = new Map()
  addAll(expected, payload.root, await instrumentTargets(payload.root, lane.full, lane.excludedMutations ?? []))

  const actual = new Map()
  let shardMutants = 0
  for (const shard of lane.shards) {
    const mutants = await instrumentTargets(payload.root, shard, lane.excludedMutations ?? [])
    shardMutants += mutants.length
    addAll(actual, payload.root, mutants)
  }
  const { missing, extra } = multisetDelta(expected, actual)
  const fullMutants = [...expected.values()].reduce((sum, count) => sum + count, 0)
  const exact = missing === 0 && extra === 0 && shardMutants === fullMutants
  const result = { lane: lane.id, full: fullMutants, shardMutants, missing, extra, exact }
  if (lane.reported) {
    const reported = new Map()
    addReported(reported, payload.root, lane.reported)
    const reportDelta = multisetDelta(expected, reported)
    result.reportMutants = [...reported.values()].reduce((sum, count) => sum + count, 0)
    result.missingReportMutants = reportDelta.missing
    result.extraReportMutants = reportDelta.extra
    result.reportExact = reportDelta.missing === 0 && reportDelta.extra === 0
  }
  results.push(result)
}

const failures = results.filter(result => !result.exact)
if (failures.length > 0) throw new Error(`Mutation shard coverage is not exact: ${JSON.stringify(failures)}`)
process.stdout.write(`${JSON.stringify(results)}\n`)
