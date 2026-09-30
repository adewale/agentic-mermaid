#!/usr/bin/env bun
// Per-PR payload growth, judged against the base branch built on the same
// runner with the same toolchain — instead of byte-exact baselines committed to
// the repository and re-recorded on Linux for every change. The route and lazy
// family byte ceilings (website-payload-budgets.ts, browser-lazy-budgets.json)
// keep generous headroom and bound accumulated growth; this check bounds each
// PR's growth and reports every delta in the job summary.

import { appendFileSync, readFileSync } from 'node:fs'

export interface PayloadSize { requests: number; raw: number; gzip: number }
export type PayloadSizes = Record<string, PayloadSize>

export interface PayloadDeltaRow {
  name: string
  base?: PayloadSize
  head?: PayloadSize
  gzipDelta: number
  gzipRatio: number
  exceeds: boolean
}

export interface PayloadDeltaLimits {
  /** Growth must exceed BOTH limits to fail, so tiny payloads do not flap. */
  maxGzipGrowthRatio: number
  minGzipGrowthBytes: number
}

export const DEFAULT_PAYLOAD_DELTA_LIMITS: PayloadDeltaLimits = Object.freeze({ maxGzipGrowthRatio: 0.02, minGzipGrowthBytes: 1024 })

export function lazySizes(report: { initial: PayloadSize; families: Record<string, PayloadSize> }): PayloadSizes {
  const sizes: PayloadSizes = { 'lazy:initial': pick(report.initial) }
  for (const [id, size] of Object.entries(report.families)) sizes[`lazy:${id}`] = pick(size)
  return sizes
}

export function websiteSizes(report: { routes: Array<{ id: string; totals: { requests: number; rawBytes: number; gzipBytes: number } }> }): PayloadSizes {
  return Object.fromEntries(report.routes.map(route => [`route:${route.id}`, {
    requests: route.totals.requests, raw: route.totals.rawBytes, gzip: route.totals.gzipBytes,
  }]))
}

function pick(size: PayloadSize): PayloadSize {
  return { requests: size.requests, raw: size.raw, gzip: size.gzip }
}

export function payloadDelta(base: PayloadSizes, head: PayloadSizes, limits: PayloadDeltaLimits = DEFAULT_PAYLOAD_DELTA_LIMITS): PayloadDeltaRow[] {
  const names = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort()
  return names.map(name => {
    const before = base[name]
    const after = head[name]
    const gzipDelta = (after?.gzip ?? 0) - (before?.gzip ?? 0)
    const gzipRatio = before && before.gzip > 0 ? gzipDelta / before.gzip : after ? Infinity : 0
    const exceeds = gzipDelta > limits.minGzipGrowthBytes && gzipRatio > limits.maxGzipGrowthRatio
    return { name, base: before, head: after, gzipDelta, gzipRatio, exceeds }
  })
}

export function payloadDeltaMarkdown(rows: readonly PayloadDeltaRow[], limits: PayloadDeltaLimits = DEFAULT_PAYLOAD_DELTA_LIMITS): string {
  const bytes = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('en-US')
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('en-US')}`
  const percent = (ratio: number) => Number.isFinite(ratio) ? `${ratio > 0 ? '+' : ''}${(ratio * 100).toFixed(2)}%` : 'new'
  return [
    `### Payload delta vs base (fails above +${(limits.maxGzipGrowthRatio * 100).toFixed(0)}% and +${limits.minGzipGrowthBytes.toLocaleString('en-US')} gzip bytes)`,
    '',
    '| Payload | Requests | Gzip base | Gzip head | Δ gzip | Δ % | |',
    '|---|---:|---:|---:|---:|---:|---|',
    ...rows.map(row => `| ${row.name} | ${row.base?.requests ?? '—'} → ${row.head?.requests ?? '—'} | ${bytes(row.base?.gzip)} | ${bytes(row.head?.gzip)} | ${signed(row.gzipDelta)} | ${percent(row.gzipRatio)} | ${row.exceeds ? '❌' : ''} |`),
    '',
  ].join('\n')
}

if (import.meta.main) {
  const value = (flag: string): string => {
    const index = process.argv.indexOf(flag)
    if (index < 0 || !process.argv[index + 1]) throw new Error(`Usage: payload-delta.ts --base-lazy a.json --head-lazy b.json --base-site c.json --head-site d.json [--allow-growth]`)
    return process.argv[index + 1]!
  }
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
  const base = { ...lazySizes(read(value('--base-lazy'))), ...websiteSizes(read(value('--base-site'))) }
  const head = { ...lazySizes(read(value('--head-lazy'))), ...websiteSizes(read(value('--head-site'))) }
  const rows = payloadDelta(base, head)
  const markdown = payloadDeltaMarkdown(rows)
  process.stdout.write(`${markdown}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  const exceeded = rows.filter(row => row.exceeds)
  if (exceeded.length > 0) {
    const message = `Payload grew beyond the per-PR limit: ${exceeded.map(row => `${row.name} ${row.gzipDelta > 0 ? '+' : ''}${row.gzipDelta} gzip bytes`).join(', ')}`
    if (process.argv.includes('--allow-growth')) {
      process.stdout.write(`${message} (approved by the payload-growth-approved label)\n`)
    } else {
      if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(`::error title=Payload delta::${message}. Label the PR payload-growth-approved if the growth is intended.\n`)
      process.stderr.write(`${message}\n`)
      process.exit(1)
    }
  }
}
