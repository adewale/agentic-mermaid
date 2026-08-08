import { createHash } from 'node:crypto'

export const RESEARCH_SCHEMA_VERSION = 2 as const
export const RESEARCH_REPOSITORIES = [
  'mermaid-js/mermaid',
  'lukilabs/beautiful-mermaid',
] as const
export const RESEARCH_MAX_AGE_DAYS = 120

export type ResearchRepository = (typeof RESEARCH_REPOSITORIES)[number]
export type ResearchItemKind = 'issue' | 'pull-request'

export const RESEARCH_FAMILIES = [
  'flowchart',
  'state',
  'sequence',
  'timeline',
  'class',
  'er',
  'journey',
  'architecture',
  'xychart',
  'pie',
  'quadrant',
  'gantt',
  'mindmap',
  'gitgraph',
  'radar',
  'sankey',
  'usecase',
  'c4',
  'requirement',
  'kanban',
  'packet',
  'block',
  'zenuml',
  'cross-cutting',
] as const

export type ResearchFamily = (typeof RESEARCH_FAMILIES)[number]

export const INTENT_CATEGORIES = [
  'new-family',
  'syntax-acceptance',
  'semantic-correctness',
  'layout-relationships',
  'text-labels',
  'styling-theming',
  'accessibility',
  'configuration',
  'output-runtime',
  'security',
  'performance',
  'interoperability',
  'uncategorized',
] as const

export type IntentCategory = (typeof INTENT_CATEGORIES)[number]

export interface ReactionCounts {
  thumbsUp: number
  thumbsDown: number
  laugh: number
  hooray: number
  confused: number
  heart: number
  rocket: number
  eyes: number
}

export interface ResearchWeightBreakdown {
  engagement: number
  popularity: number
  recency: number
  kind: number
  actor: number
  score: number
}

export interface ResearchItem {
  repository: ResearchRepository
  kind: ResearchItemKind
  number: number
  title: string
  url: string
  state: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
  mergedAt?: string | null
  draft?: boolean
  author: string | null
  authorIsBot: boolean
  labels: readonly string[]
  comments: number
  participants: number
  reviews: number
  reactions: ReactionCounts
  bodyDigest: string
  families: readonly ResearchFamily[]
  categories: readonly IntentCategory[]
  matchedTerms: readonly string[]
  weight: ResearchWeightBreakdown
}

export interface RepositoryHarvestSummary {
  repository: ResearchRepository
  url: string
  issueCount: number
  pullRequestCount: number
}

export interface ResearchHarvest {
  schemaVersion: typeof RESEARCH_SCHEMA_VERSION
  capturedAt: string
  referenceDate: string
  collector: string
  collectionBoundary: string
  weighting: {
    activityHalfLifeDays: number
    recencyFloor: number
    issueMultiplier: number
    pullRequestMultiplier: number
    mergedPullRequestMultiplier: number
    botMultiplier: number
  }
  repositories: readonly RepositoryHarvestSummary[]
  items: readonly ResearchItem[]
  contentDigest: string
}

export const DEFAULT_RESEARCH_WEIGHTING = Object.freeze({
  activityHalfLifeDays: 730,
  recencyFloor: 0.2,
  issueMultiplier: 1,
  pullRequestMultiplier: 0.65,
  mergedPullRequestMultiplier: 0.85,
  botMultiplier: 0.1,
})

const FAMILY_RULES: Readonly<Record<Exclude<ResearchFamily, 'cross-cutting'>, readonly RegExp[]>> = {
  flowchart: [/\bflow\s*chart\b/i, /\bflowchart\b/i, /\bsubgraph\b/i, /\bgraph\s+(?:tb|td|bt|lr|rl)\b/i],
  state: [/\bstate\s*diagram\b/i, /\bstatediagram(?:-v2)?\b/i, /\bpseudostate\b/i],
  sequence: [/\bsequence\s*diagram\b/i, /\bsequencediagram\b/i, /\blifeline\b/i, /\bparticipant\b.*\bactivate\b/i],
  timeline: [/\btimeline\s*(?:diagram)?\b/i],
  class: [/\bclass\s*diagram\b/i, /\bclassdiagram(?:-v2)?\b/i, /\buml\s+class\b/i],
  er: [/\ber\s*diagram\b/i, /\berdiagram\b/i, /\bentity[ -]relationship\b/i, /\bcrow['’]?s?[- ]foot\b/i],
  journey: [/\buser\s*journey\b/i, /\bjourney\s*diagram\b/i, /\bjourney\b.*\bscore\b/i],
  architecture: [/\barchitecture\s*(?:diagram|-beta)?\b/i],
  xychart: [/\bxy\s*chart\b/i, /\bxychart(?:-beta)?\b/i],
  pie: [/\bpie\s*(?:chart|diagram)\b/i, /\bpie-beta\b/i],
  quadrant: [/\bquadrant\s*(?:chart|diagram)?\b/i, /\bquadrantchart\b/i],
  gantt: [/\bgantt\b/i],
  mindmap: [/\bmind\s*map\b/i, /\bmindmap\b/i],
  gitgraph: [/\bgit\s*graph\b/i, /\bgitgraph\b/i, /\bcherry-pick\b/i],
  radar: [/\bradar\s*(?:chart|diagram)?\b/i],
  sankey: [/\bsankey\b/i],
  usecase: [/\buse[- ]?case\s+diagram\b/i, /\busecase(?:diagram)?\b/i],
  c4: [/\bc4\s*(?:diagram|context|container|component|dynamic|deployment)?\b/i, /\bc4context\b/i],
  requirement: [/\brequirement\s*diagram\b/i, /\brequirementdiagram\b/i],
  kanban: [/\bkanban\b/i],
  packet: [/\bpacket\s*diagram\b/i, /\bpacket-beta\b/i],
  block: [/\bblock\s*diagram\b/i, /\bblock-beta\b/i],
  zenuml: [/\bzenuml\b/i],
}

const CATEGORY_RULES: Readonly<Record<Exclude<IntentCategory, 'uncategorized'>, readonly RegExp[]>> = {
  'new-family': [/\bnew\s+diagram\b/i, /\badd\b.*\bdiagram\b/i, /\bsupport\b.*\bdiagram\b/i, /type:\s*new\s*diagram/i],
  'syntax-acceptance': [/\bsyntax\b/i, /\bpars(?:e|er|ing)\b/i, /\bunsupported\b/i, /\bunrecognized\b/i, /\binvalid\b/i, /\bgrammar\b/i],
  'semantic-correctness': [/\bwrong\b/i, /\bincorrect\b/i, /\bbroken\b/i, /\bmissing\b/i, /\blost\b/i, /\bduplicate[sd]?\b/i, /\bphantom\b/i, /\border\b/i, /\bdirection\b/i, /\bcardinalit(?:y|ies)\b/i, /\bdependency\b/i],
  'layout-relationships': [/\blayout\b/i, /\boverlap\b/i, /\boverflow\b/i, /\bspacing\b/i, /\balign(?:ment|ed)?\b/i, /\bposition\b/i, /\brout(?:e|ing)\b/i, /\bcrossing\b/i, /\bsubgraph\b/i, /\bedge\b/i],
  'text-labels': [/\btext\b/i, /\blabels?\b/i, /\bfonts?\b/i, /\bwrap(?:ping)?\b/i, /\bunicode\b/i, /\bemoji\b/i, /\bcjk\b/i, /\bhtml\b/i, /\bmarkdown\b/i],
  'styling-theming': [/\btheme\b/i, /\bstyle\b/i, /\bcolour\b/i, /\bcolor\b/i, /\bcss\b/i, /\bfill\b/i, /\bstroke\b/i, /\bgradient\b/i, /\bdark\s*mode\b/i],
  accessibility: [/\baccessib(?:ility|le)\b/i, /\ba11y\b/i, /\bscreen\s*reader\b/i, /\baria\b/i],
  configuration: [/\bconfig(?:uration)?\b/i, /\bfront\s*matter\b/i, /\bdirective\b/i, /\binit\b/i],
  'output-runtime': [/\bsvg\b/i, /\bpng\b/i, /\bpdf\b/i, /\bascii\b/i, /\bexport\b/i, /\brender(?:er|ing)?\b/i, /\bserver[- ]side\b/i, /\bssr\b/i, /\bnode(?:\.js)?\b/i, /\bbrowser\b/i],
  security: [/\bsecurity\b/i, /\bxss\b/i, /\bsanitiz(?:e|er|ing)\b/i, /\bcsp\b/i, /\bexternal\s+(?:image|request|url)\b/i],
  performance: [/\bperformance\b/i, /\bslow\b/i, /\bmemory\b/i, /\bbundle\s*size\b/i, /\btimeout\b/i],
  interoperability: [/\bcompatib(?:ility|le)\b/i, /\binteroperab(?:ility|le)\b/i, /\bintegrat(?:e|ion)\b/i, /\bgithub\b/i, /\bvscode\b/i, /\bmarkdown\b/i],
}

function matchedRuleNames<T extends string>(text: string, rules: Readonly<Record<T, readonly RegExp[]>>): T[] {
  return (Object.entries(rules) as Array<[T, readonly RegExp[]]>)
    .filter(([, patterns]) => patterns.some(pattern => pattern.test(text)))
    .map(([name]) => name)
}

export function classifyResearchText(title: string, body: string, labels: readonly string[]): {
  families: ResearchFamily[]
  categories: IntentCategory[]
  matchedTerms: string[]
} {
  const headline = `${title}\n${labels.join('\n')}`
  const text = `${headline}\n${body}`
  const headlineFamilies = matchedRuleNames(headline, FAMILY_RULES)
  const families = headlineFamilies.length > 0 ? headlineFamilies : matchedRuleNames(body, FAMILY_RULES)
  const categories = matchedRuleNames(text, CATEGORY_RULES)
  const matchedTerms = [
    ...families.map(value => `family:${value}`),
    ...categories.map(value => `intent:${value}`),
  ]
  return {
    families: families.length > 0 ? families : ['cross-cutting'],
    categories: categories.length > 0 ? categories : ['uncategorized'],
    matchedTerms,
  }
}

export function emptyReactionCounts(): ReactionCounts {
  return { thumbsUp: 0, thumbsDown: 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 }
}

export function scoreResearchItem(input: {
  kind: ResearchItemKind
  merged: boolean
  authorIsBot: boolean
  comments: number
  participants: number
  reviews: number
  reactions: ReactionCounts
  updatedAt: string
  referenceDate: string
}): ResearchWeightBreakdown {
  const { reactions } = input
  const positiveReactions =
    reactions.thumbsUp +
    reactions.heart * 1.4 +
    reactions.hooray * 1.2 +
    reactions.rocket * 1.2 +
    reactions.eyes * 0.5 +
    reactions.laugh * 0.25
  const negativeReactions = reactions.thumbsDown * 0.5 + reactions.confused * 0.25
  const engagement = Math.max(
    0,
    positiveReactions - negativeReactions + input.comments * 0.35 + Math.max(0, input.participants - 1) * 0.5 + input.reviews * 0.35,
  )
  const popularity = 1 + Math.log1p(engagement)
  const reference = Date.parse(input.referenceDate)
  const updated = Date.parse(input.updatedAt)
  const ageDays = Math.max(0, (reference - updated) / 86_400_000)
  const decay = 2 ** (-ageDays / DEFAULT_RESEARCH_WEIGHTING.activityHalfLifeDays)
  const recency = DEFAULT_RESEARCH_WEIGHTING.recencyFloor + (1 - DEFAULT_RESEARCH_WEIGHTING.recencyFloor) * decay
  const kind = input.kind === 'issue'
    ? DEFAULT_RESEARCH_WEIGHTING.issueMultiplier
    : input.merged
      ? DEFAULT_RESEARCH_WEIGHTING.mergedPullRequestMultiplier
      : DEFAULT_RESEARCH_WEIGHTING.pullRequestMultiplier
  const actor = input.authorIsBot ? DEFAULT_RESEARCH_WEIGHTING.botMultiplier : 1
  return {
    engagement: round(engagement),
    popularity: round(popularity),
    recency: round(recency),
    kind,
    actor,
    score: round(popularity * recency * kind * actor),
  }
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

export function digestText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function researchHarvestDigest(harvest: Omit<ResearchHarvest, 'contentDigest'> | ResearchHarvest): string {
  const canonical = { ...harvest, contentDigest: '' }
  return digestText(`${JSON.stringify(canonical)}\n`)
}

export function validateResearchHarvest(harvest: ResearchHarvest, now = new Date()): void {
  if (harvest.schemaVersion !== RESEARCH_SCHEMA_VERSION) throw new Error(`Unsupported research schema ${harvest.schemaVersion}`)
  if (harvest.collector !== 'GitHub GraphQL repository pagination v1') throw new Error(`Unexpected collector: ${harvest.collector}`)
  if (JSON.stringify(harvest.weighting) !== JSON.stringify(DEFAULT_RESEARCH_WEIGHTING)) throw new Error('Research weighting policy changed')
  const expectedRepositories = [...RESEARCH_REPOSITORIES].sort()
  const actualRepositories = harvest.repositories.map(item => item.repository).sort()
  if (JSON.stringify(actualRepositories) !== JSON.stringify(expectedRepositories)) throw new Error('Research repository coverage is incomplete')
  if (researchHarvestDigest(harvest) !== harvest.contentDigest) throw new Error('Research harvest content digest does not match')

  const capturedAt = Date.parse(harvest.capturedAt)
  const referenceDate = Date.parse(harvest.referenceDate)
  if (!Number.isFinite(capturedAt)) throw new Error('Research capturedAt is invalid')
  if (!Number.isFinite(referenceDate) || referenceDate !== capturedAt) throw new Error('Research referenceDate must equal capturedAt')
  const ageDays = (now.getTime() - capturedAt) / 86_400_000
  if (ageDays < -1 || ageDays > RESEARCH_MAX_AGE_DAYS) throw new Error(`Research harvest is stale (${Math.floor(ageDays)} days old; max ${RESEARCH_MAX_AGE_DAYS})`)

  const seen = new Set<string>()
  for (const item of harvest.items) {
    const key = `${item.repository}:${item.kind}:${item.number}`
    if (seen.has(key)) throw new Error(`Duplicate research item ${key}`)
    seen.add(key)
    if (!item.url.startsWith(`https://github.com/${item.repository}/`)) throw new Error(`Invalid research URL for ${key}`)
    if (item.families.length === 0 || item.categories.length === 0) throw new Error(`Unclassified research item ${key}`)
    if (item.families.some(family => !RESEARCH_FAMILIES.includes(family))) throw new Error(`Unknown research family for ${key}`)
    if (item.categories.some(category => !INTENT_CATEGORIES.includes(category))) throw new Error(`Unknown intent category for ${key}`)
    if (item.comments < 0 || item.participants < 0 || item.reviews < 0) throw new Error(`Negative engagement count for ${key}`)
    const expectedWeight = scoreResearchItem({
      kind: item.kind,
      merged: Boolean(item.mergedAt),
      authorIsBot: item.authorIsBot,
      comments: item.comments,
      participants: item.participants,
      reviews: item.reviews,
      reactions: item.reactions,
      updatedAt: item.updatedAt,
      referenceDate: harvest.referenceDate,
    })
    if (JSON.stringify(expectedWeight) !== JSON.stringify(item.weight)) throw new Error(`Stale weight for ${key}`)
  }

  for (const repository of harvest.repositories) {
    const issues = harvest.items.filter(item => item.repository === repository.repository && item.kind === 'issue').length
    const pullRequests = harvest.items.filter(item => item.repository === repository.repository && item.kind === 'pull-request').length
    if (issues !== repository.issueCount || pullRequests !== repository.pullRequestCount) {
      throw new Error(`Research count mismatch for ${repository.repository}`)
    }
  }
}
