// ============================================================================
// Shared categorical palette — the single home for derived peer-category
// colors used by pie/radar, xychart, journey, mindmap, and gitgraph.
//
// Small charts (≤ MONO_LADDER_MAX slices) start from the existing xychart
// same-family ladder: accent-anchored shades that read as one palette across
// chart families. The ladder alone can collide at any count (its tiers can land
// on the accent's own lightness), so small palettes are repaired against the
// same visibility and ΔE floors described below. Past that count the ladder
// degenerates into near-identical neighbors everywhere (the Journey actor-dot
// defect class — plan §Pie item 4; measured: two of fifteen ladder colors sit
// at WCAG 1.01:1 against each other), so high-count charts switch to a
// hue-rotation wheel SIZED TO THE SLICE COUNT
// (P1: palettes sized to element counts instead of modulo wraps):
//   - hues spread evenly from the accent hue (360/count steps — every pair of
//     same-lightness colors is ≥ 2·(360/count) apart)
//   - lightness alternates between two tiers held at CONSTANT OKLCH lightness,
//     not HSL: equal HSL lightness across hues is unequal PERCEIVED lightness
//     (a yellow reads far lighter than a blue at the same HSL L), which is what
//     let hue-adjacent slices collapse toward each other. OKLCH tiers separate
//     evenly by construction (idea #1).
//   - a minimum ΔE_OK floor is then enforced pairwise, so no two slice fills
//     read as the same color, up to a couple dozen slices (idea #2). Past that
//     the sRGB gamut is exhausted: pairwise repair stops, generation stays
//     linear, and uniqueness/separation become best-effort while background
//     visibility remains enforced when the background resolves to opaque sRGB.
//     The hard range is covered by the test.
//   - every color is nudged (deterministically) away from the background until
//     it clears BOTH a WCAG floor (the historical guard) and an APCA lightness-
//     contrast floor. APCA is polarity-aware, so it catches wedges that WCAG
//     calls visible but that vanish on a dark theme (idea #3).
// The perceptual primitives live in src/shared/perceptual-color.ts, beside the
// WCAG ones in src/shared/color-math.ts.
//
// Family-specific authored palette variables are applied by each consumer
// after this derived palette, so explicit author intent remains authoritative.
// ============================================================================

import { CHART_ACCENT_FALLBACK, getSeriesColor } from '../xychart/colors.ts'
import { mixHex, toHex, tryParseCssColor, WCAG_AA_TEXT_CONTRAST, wcagContrastRatio } from './color-math.ts'
import { apcaContrast, deltaEOK, hexToOklab, hexToOklch, minPairwiseDeltaEOK, type Oklab, type Oklch, oklchToHex } from './perceptual-color.ts'

export interface CategoricalPaletteInputs {
  /** Theme accent. Parser-resolvable CSS colors are normalized above six peers. */
  accent?: string
  /** Theme background. Parser-resolvable opaque CSS colors are normalized. */
  bg?: string
  /** Optional concrete opaque label ink. If bounded search cannot satisfy
   * visibility, text contrast and peer separation, throws a prescriptive error. */
  labelInk?: string
}

export interface CategoricalPaletteDiagnostics {
  path: 'legacy-ladder' | 'bounded-repair' | 'linear-tail'
  requestedCount: number
  emittedCount: number
  candidateEvaluations: number
  pairDistanceChecks: number
  tailItems: number
}

export interface CategoricalPaletteResult {
  colors: string[]
  diagnostics: CategoricalPaletteDiagnostics
}

/** Largest slice count still served by the monochrome same-family ladder. */
const MONO_LADDER_MAX = 6

/** Wedge-visibility floor: a slice fill must clear this WCAG ratio vs the bg. */
const BG_CONTRAST_FLOOR = 1.25

/** Wedge-visibility floor in APCA lightness contrast (|Lc|). ~15 is the APCA
 *  guidance for large, non-text color areas; unlike WCAG it does not overstate
 *  dark-on-dark, so it catches wedges that vanish on a dark theme. */
const BG_APCA_FLOOR = 15

/** Minimum perceptual separation (ΔE_OK) between any two slice fills. 0.10 sits
 *  comfortably above the just-noticeable ~0.02 and above the 0.053 the old HSL
 *  ladder degenerated to, so no two wedges read as the same color. */
const MIN_SLICE_DELTA_E = 0.1

/** The documented range in which the categorical-separation floor is a hard
 * contract. Above it, searching every color pair is both quadratic and
 * misleading: the available visible sRGB volume cannot sustain the floor. */
const GUARANTEED_DELTA_E_MAX = 24

/** OKLCH hue anchoring the wheel when the accent has no meaningful hue (the
 *  default grey theme) — the indigo family the derived palettes lean on. */
const NEUTRAL_BASE_HUE = 264

/** Accent chroma is clamped into a lively-but-printable band before the sweep. */
const SLICE_CHROMA_MIN = 0.11
const SLICE_CHROMA_MAX = 0.16

/** Shared derived palette for peer categorical series. Author-supplied family
 * overrides are deliberately applied by each renderer after this function. */
export function categoricalPalette(count: number, inputs: CategoricalPaletteInputs = {}): string[] {
  return categoricalPaletteInternal(count, inputs)
}

/** Instrumented internal contract used by deterministic complexity tests and
 * the reproducible performance report. It is intentionally not re-exported by
 * the package entrypoint: callers consume colors, while repository tooling can
 * observe which bounded algorithmic path actually ran. */
export function categoricalPaletteWithDiagnostics(count: number, inputs: CategoricalPaletteInputs = {}): CategoricalPaletteResult {
  const diagnostics: CategoricalPaletteDiagnostics = {
    path: count <= MONO_LADDER_MAX ? 'legacy-ladder' : count <= GUARANTEED_DELTA_E_MAX ? 'bounded-repair' : 'linear-tail',
    requestedCount: count,
    emittedCount: 0,
    candidateEvaluations: 0,
    pairDistanceChecks: 0,
    tailItems: 0,
  }
  const colors = categoricalPaletteInternal(count, inputs, diagnostics)
  diagnostics.emittedCount = colors.length
  return { colors, diagnostics }
}

function categoricalPaletteInternal(count: number, inputs: CategoricalPaletteInputs, diagnostics?: CategoricalPaletteDiagnostics): string[] {
  const labelInk = concreteCssHex(inputs.labelInk)
  let retainedCandidates: LabCandidate[] | undefined
  // One request-local corpus serves failed seed searches and later packing.
  const candidates = labelInk === undefined ? undefined : () => retainedCandidates ??= visibleCandidateCorpus(concreteCssHex(inputs.bg), diagnostics, labelInk)
  if (count <= MONO_LADDER_MAX) {
    // The legacy getSeriesColor ladder is the starting point, including authored
    // CSS spelling in slot zero and its historical fallback behaviour for the
    // remaining ladder. Normalizing here would change #rgb/named/rgb() bytes.
    const legacyAccent = inputs.accent ?? CHART_ACCENT_FALLBACK
    const ladder = Array.from({ length: Math.max(0, count) }, (_unused, index) => getSeriesColor(index, legacyAccent, inputs.bg))
    return repairLegacyLadder(ladder, inputs.bg, diagnostics, labelInk, candidates)
  }

  const safeBg = concreteCssHex(inputs.bg)
  const safeAccent = concreteCssHex(inputs.accent, safeBg) ?? CHART_ACCENT_FALLBACK
  return hueSpreadColors(count, safeAccent, safeBg, diagnostics, labelInk, candidates)
}

/** Small palettes owe the same contract as large ones: every fill visible
 * against the background and every pair at least MIN_SLICE_DELTA_E apart. The
 * ladder's alternating tiers collide with the accent itself (measured: at six
 * slices every built-in palette held a pair below ΔE_OK 0.06), so it is
 * repaired with the same bounded searches as the hue wheel. Fills that already
 * satisfy the contract keep their exact bytes. A palette containing a color that
 * cannot be resolved to concrete sRGB is returned unchanged: it cannot be
 * measured, like the LOW_CONTRAST rule for an unknown backdrop. */
function repairLegacyLadder(ladder: string[], rawBg: string | undefined, diagnostics?: CategoricalPaletteDiagnostics, labelInk?: string, candidates?: () => LabCandidate[]): string[] {
  const bg = concreteCssHex(rawBg)
  const measured = ladder.map(color => concreteCssHex(color, bg))
  if (measured.some(color => color === undefined)) return ladder
  const concrete = measured as string[]
  const dark = ((bg === undefined ? null : hexToOklab(bg))?.L ?? 1) < 0.55
  const visible = concrete.map(hex => {
    if (isVisible(hex, bg, labelInk)) return hex
    const lch = hexToOklch(hex)
    return lch ? ensureBgContrast(lch, bg, dark, diagnostics, labelInk, candidates) : hex
  })
  const separated = visible.length > 1 ? enforceMinDeltaE(visible, bg, dark, diagnostics, labelInk, candidates) : visible
  return separated.map((hex, index) => hex === concrete[index] ? ladder[index]! : hex)
}

/** Normalize the concrete CSS forms accepted by StyleSpec into the six-digit
 * sRGB representation required by the perceptual math. A translucent accent
 * can be resolved exactly when its opaque rendered background is known;
 * translucent backgrounds and dynamic CSS forms remain intentionally unknown. */
function concreteCssHex(value: string | undefined, opaqueBackground?: string): string | undefined {
  if (value === undefined) return undefined
  const parsed = tryParseCssColor(value)
  if (!parsed) return undefined
  if (parsed[3] === 1) return toHex(parsed[0], parsed[1], parsed[2])
  if (opaqueBackground === undefined) return undefined
  const bg = tryParseCssColor(opaqueBackground)
  if (!bg || bg[3] !== 1) return undefined
  return toHex(parsed[0] * parsed[3] + bg[0] * (1 - parsed[3]), parsed[1] * parsed[3] + bg[1] * (1 - parsed[3]), parsed[2] * parsed[3] + bg[2] * (1 - parsed[3]))
}

function hueSpreadColors(count: number, accent: string, bg: string | undefined, diagnostics?: CategoricalPaletteDiagnostics, labelInk?: string, candidates?: () => LabCandidate[]): string[] {
  const accentLch = hexToOklch(accent) ?? { L: 0.6, C: SLICE_CHROMA_MAX, h: NEUTRAL_BASE_HUE }
  // Neutral accents (the default grey theme) have no meaningful hue; anchor the
  // wheel on the indigo family the derived palettes lean on.
  const neutral = accentLch.C < 0.03
  const baseHue = neutral ? NEUTRAL_BASE_HUE : accentLch.h
  const chroma = Math.max(SLICE_CHROMA_MIN, Math.min(SLICE_CHROMA_MAX, neutral ? SLICE_CHROMA_MAX : accentLch.C))
  // Perceived lightness, not HSL lightness, decides the starting polarity.
  // Saturated yellow/green pages can have a low HSL L while being perceptually
  // very bright; HSL sent those palettes toward the background instead of away.
  const dark = ((bg === undefined ? null : hexToOklab(bg))?.L ?? 1) < 0.55
  // Two CONSTANT-OKLCH-LIGHTNESS tiers so hue-adjacent slices separate in
  // perceived lightness by a fixed amount at every hue (HSL's flaw was that its
  // fixed L is unequal perceived L across hues). On dark backgrounds both tiers
  // sit lighter than the page; on light backgrounds both sit darker.
  const tiers: [number, number] = dark ? [0.74, 0.6] : [0.56, 0.7]
  const step = 360 / count
  const colors = Array.from({ length: count }, (_unused, index) => {
    // Preserve the exact accent when it is visible; otherwise apply the same
    // background-visibility construction used for every other derived slice.
    if (index === 0 && isVisible(accent, bg, labelInk)) return accent
    const hue = index === 0 ? baseHue : (((baseHue + index * step) % 360) + 360) % 360
    const startL = index === 0 ? accentLch.L : tiers[index % 2]!
    return ensureBgContrast({ L: startL, C: chroma, h: hue }, bg, dark, diagnostics, labelInk, candidates)
  })
  // Pairwise repair is deliberately bounded to the range whose separation
  // contract we can satisfy. Large palettes stay linear in slice count.
  return count <= GUARANTEED_DELTA_E_MAX ? enforceMinDeltaE(colors, bg, dark, diagnostics, labelInk, candidates) : dedupeBestEffort(colors, bg, dark, diagnostics, labelInk, candidates)
}

/** A fill is "visible" when it clears BOTH background wedge floors and any
 * concrete label-ink constraint. Unknown backgrounds impose no page floor. */
function isVisible(hex: string, bg: string | undefined, labelInk?: string): boolean {
  if (labelInk !== undefined && (wcagContrastRatio(hex, labelInk) ?? 0) < WCAG_AA_TEXT_CONTRAST) return false
  if (bg === undefined) return true
  const wcag = wcagContrastRatio(hex, bg)
  const apca = apcaContrast(hex, bg)
  return wcag !== null && apca !== null && wcag >= BG_CONTRAST_FLOOR && apca >= BG_APCA_FLOOR
}

/**
 * Search both OKLCH-lightness directions for a visible fill. The background's
 * actual OKLab lightness chooses which direction is tried first; the opposite
 * direction remains available because chroma gamut-clamping is non-monotonic.
 */
function ensureBgContrast(lch: Oklch, bg: string | undefined, darkBg: boolean, diagnostics?: CategoricalPaletteDiagnostics, labelInk?: string, candidates?: () => LabCandidate[]): string {
  if (diagnostics) diagnostics.candidateEvaluations++
  const initial = oklchToHex(lch)
  if (isVisible(initial, bg, labelInk)) return initial
  const bgL = (bg === undefined ? undefined : hexToOklab(bg))?.L ?? (darkBg ? 0 : 1)
  const preferred = lch.L >= bgL ? 1 : -1
  for (let i = 1; i <= 24; i++) {
    const amount = i * 0.04
    for (const direction of [preferred, -preferred]) {
      if (diagnostics) diagnostics.candidateEvaluations++
      const hex = oklchToHex({ ...lch, L: clampL(lch.L + direction * amount) })
      if (isVisible(hex, bg, labelInk)) return hex
    }
  }

  // Without a label-ink constraint, a concrete background always has a visible
  // achromatic extreme. A constrained search must satisfy both paint roles.
  const extremes = ['#000000', '#ffffff'].filter(hex => isVisible(hex, bg, labelInk))
  if (extremes.length > 0) {
    return extremes.sort((a, b) => (bg === undefined ? 0 : (apcaContrast(b, bg) ?? 0) - (apcaContrast(a, bg) ?? 0)))[0]!
  }
  // A bounded search failure does not prove the joint constraints impossible.
  // Fail closed rather than return a known contrast violation.
  if (labelInk !== undefined) {
    // A fixed-hue lightness search can miss a valid joint-contrast band. Try
    // the existing finite global corpus before rejecting the configuration.
    const target = hexToOklab(initial)
    let best: LabCandidate | undefined
    let distance = Infinity
    for (const candidate of candidates?.() ?? visibleCandidateCorpus(bg, diagnostics, labelInk)) {
      if (diagnostics) {
        diagnostics.candidateEvaluations++
        if (target) diagnostics.pairDistanceChecks++
      }
      const next = target ? constrainedLabDistance(candidate.lab, target) : 0
      if (next < distance) { best = candidate; distance = next }
    }
    if (best) return best.hex
    throwPaletteConstraint()
  }
  return initial
}

function throwPaletteConstraint(): never {
  throw new Error('Cannot derive categorical fills within bounded search with readable label ink, page visibility and distinct peer colors; select a different textColor or explicit fillColor')
}

/**
 * Effective-paint visibility for TRANSLUCENT marks. The wedge floors above
 * were derived for OPAQUE fills; a mark drawn at partial opacity closes most
 * of its distance to the page, so a raw-visible paint can composite to
 * invisible (measured: palette colors that clear WCAG 1.25 / APCA 15 raw drop
 * to WCAG ≈1.0 / APCA 0 at 50% over several built-in backgrounds — the sankey
 * ribbon class). This is `ensureBgContrast` with the floors judged on the
 * alpha-composited candidate instead of the raw one: same bounded OKLCH
 * lightness search, same achromatic-extreme totality fallback. A paint whose
 * composite already clears both floors is returned byte-identical, and an
 * unmeasurable (non-opaque or unparsable) background returns the paint
 * unchanged — the LOW_CONTRAST rule: an unknown backdrop is not measured.
 * Authored paints stay authoritative and must not route through here.
 */
export function ensureCompositedBgContrast(paint: string, bg: string | undefined, opacityPct: number): string {
  const bgRgba = bg === undefined ? null : tryParseCssColor(bg)
  if (!bgRgba || bgRgba[3] !== 1) return paint
  const bgHex = toHex(bgRgba[0], bgRgba[1], bgRgba[2])
  const paintRgba = tryParseCssColor(paint)
  if (!paintRgba || paintRgba[3] !== 1) return paint
  const paintHex = toHex(paintRgba[0], paintRgba[1], paintRgba[2])
  const composite = (hex: string): string => mixHex(hex, bgHex, opacityPct)
  if (isVisible(composite(paintHex), bgHex)) return paint
  const lch = hexToOklch(paintHex)
  if (!lch) return paint
  const bgL = hexToOklab(bgHex)?.L ?? 1
  const preferred = lch.L >= bgL ? 1 : -1
  for (let i = 1; i <= 24; i++) {
    const amount = i * 0.04
    for (const direction of [preferred, -preferred]) {
      const hex = oklchToHex({ ...lch, L: clampL(lch.L + direction * amount) })
      if (isVisible(composite(hex), bgHex)) return hex
    }
  }
  return ['#000000', '#ffffff'].sort((a, b) => (apcaContrast(composite(b), bgHex) ?? 0) - (apcaContrast(composite(a), bgHex) ?? 0))[0]!
}

/**
 * Guarantee every pair of fills is at least MIN_SLICE_DELTA_E apart in OKLCH.
 * Colors are visited in source order; a fill too close to an already-accepted
 * one is separated by a bounded, deterministic local search. Slice 0 (the exact
 * accent, when visible) is never moved.
 */
function enforceMinDeltaE(colors: string[], bg: string | undefined, darkBg: boolean, diagnostics?: CategoricalPaletteDiagnostics, labelInk?: string, candidates?: () => LabCandidate[]): string[] {
  const out: string[] = []
  for (let index = 0; index < colors.length; index++) {
    const hex = colors[index]!
    const anchored = index === 0 && isVisible(hex, bg, labelInk)
    out.push(anchored || minDeltaTo(hex, out, diagnostics) >= MIN_SLICE_DELTA_E ? hex : separate(hex, out, bg, darkBg, diagnostics, labelInk))
  }
  // The local repair preserves established palettes when it succeeds. If it
  // cannot meet the documented floor, use a bounded global packing pass over
  // concrete, background-visible sRGB candidates instead of returning a known
  // contract violation.
  if (diagnostics) diagnostics.pairDistanceChecks += (out.length * (out.length - 1)) / 2
  if (minPairwiseDeltaEOK(out) >= MIN_SLICE_DELTA_E) return out
  const packed = packVisibleColors(out, bg, diagnostics, labelInk, candidates)
  if (labelInk !== undefined && measuredPairwiseMinimum(packed, diagnostics) < MIN_SLICE_DELTA_E) throwPaletteConstraint()
  return packed
}

/** Account for the bounded constrained-path validation work as well as search. */
function measuredPairwiseMinimum(colors: string[], diagnostics?: CategoricalPaletteDiagnostics): number {
  if (diagnostics) diagnostics.pairDistanceChecks += (colors.length * (colors.length - 1)) / 2
  return minPairwiseDeltaEOK(colors)
}

/** Smallest ΔE_OK from `hex` to any already-accepted color (Infinity if none). */
function minDeltaTo(hex: string, accepted: string[], diagnostics?: CategoricalPaletteDiagnostics): number {
  let min = Infinity
  for (const other of accepted) {
    if (diagnostics) diagnostics.pairDistanceChecks++
    const d = deltaEOK(hex, other)
    if (d !== null && d < min) min = d
  }
  return min
}

const clampL = (L: number): number => Math.max(0.08, Math.min(0.97, L))

/**
 * Deterministically nudge `hex` away from every accepted color until it clears
 * MIN_SLICE_DELTA_E while staying background-visible. Candidates are tried in a
 * fixed order (lightness both ways, then hue rotation, then a combination) at
 * growing magnitude — the first that clears the floor wins; if none does (a
 * pathological count with no gamut headroom), the most-separated visible
 * candidate is kept so the output is always defined and never regresses.
 */
function separate(hex: string, accepted: string[], bg: string | undefined, darkBg: boolean, diagnostics?: CategoricalPaletteDiagnostics, labelInk?: string): string {
  const base = hexToOklch(hex)
  if (!base) return hex
  let best = hex
  let bestMin = minDeltaTo(hex, accepted, diagnostics)
  for (let k = 1; k <= 12; k++) {
    const dL = k * 0.03
    const dH = k * 7
    const candidates: Oklch[] = [
      { ...base, L: clampL(base.L + dL) },
      { ...base, L: clampL(base.L - dL) },
      { ...base, h: (base.h + dH) % 360 },
      { ...base, h: (base.h - dH + 360) % 360 },
      { ...base, L: clampL(darkBg ? base.L + dL : base.L - dL), h: (base.h + dH) % 360 },
    ]
    for (const cand of candidates) {
      if (diagnostics) diagnostics.candidateEvaluations++
      const candHex = oklchToHex(cand)
      if (!isVisible(candHex, bg, labelInk)) continue
      const m = minDeltaTo(candHex, accepted, diagnostics)
      if (m >= MIN_SLICE_DELTA_E) return candHex
      if (m > bestMin) {
        bestMin = m
        best = candHex
      }
    }
  }
  return best
}

interface LabCandidate {
  hex: string
  lab: Oklab
}

/** A deterministic finite candidate corpus in concrete sRGB. It is generated
 * only when local repair fails. Gamut-clamped duplicates are removed before
 * packing. It is intentionally not cached by caller-controlled background:
 * an unbounded color-key cache would turn custom themes into a memory leak. */
function visibleCandidateCorpus(bg: string | undefined, diagnostics?: CategoricalPaletteDiagnostics, labelInk?: string): LabCandidate[] {
  const byHex = new Map<string, LabCandidate>()
  const add = (hex: string): void => {
    if (diagnostics) diagnostics.candidateEvaluations++
    if (byHex.has(hex) || !isVisible(hex, bg, labelInk)) return
    const lab = hexToOklab(hex)
    if (lab) byHex.set(hex, { hex, lab })
  }
  add('#000000')
  add('#ffffff')
  const constrained = labelInk !== undefined
  const lightnessSteps = constrained ? 44 : 22
  const chromas = constrained ? Array.from({ length: 14 }, (_unused, index) => (index + 1) * 0.02) : [0.04, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28]
  for (let li = 0; li <= lightnessSteps; li++) {
    const L = 0.08 + li * (constrained ? 0.02 : 0.04)
    add(oklchToHex({ L, C: 0, h: 0 }))
    for (const C of chromas) {
      for (let h = 0; h < 360; h += constrained ? 5 : 10) add(oklchToHex({ L, C, h }))
    }
  }
  // Ink constraints can leave only a narrow lightness band. Include the
  // boundaries of concrete sRGB, which OKLCH gamut clamping samples unevenly.
  // This adds at most 4,096 candidates and is absent from the default path.
  if (labelInk !== undefined) {
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) add(toHex(r, g, b))
      }
    }
  }
  return [...byHex.values()]
}

const labDistance = (a: Oklab, b: Oklab): number => Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b)
// Constrained candidates come from finite concrete sRGB. Their bounded OKLab
// components need no overflow scaling from the general-purpose hypot call.
const constrainedLabDistance = (a: Oklab, b: Oklab): number => {
  const dL = a.L - b.L, da = a.a - b.a, db = a.b - b.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

/** Farthest-point packing over a bounded visible candidate corpus. Slice zero
 * remains anchored when valid; each subsequent choice maximizes its minimum
 * distance to the whole accepted set. */
function packVisibleColors(targets: string[], bg: string | undefined, diagnostics?: CategoricalPaletteDiagnostics, labelInk?: string, candidates?: () => LabCandidate[]): string[] {
  if (targets.length < 2) return targets
  const distance = labelInk === undefined ? labDistance : constrainedLabDistance
  const corpus = candidates?.() ?? visibleCandidateCorpus(bg, diagnostics, labelInk)
  const target0 = hexToOklab(targets[0]!)
  if (!target0) return targets
  const anchor = { hex: targets[0]!, lab: target0 }
  const anchorDistances = labelInk === undefined ? undefined : Float64Array.from(corpus, candidate => {
    if (diagnostics) diagnostics.pairDistanceChecks++
    return distance(candidate.lab, anchor.lab)
  })
  const pack = (second?: LabCandidate): string[] => {
    const selected: LabCandidate[] = second ? [anchor, second] : [anchor]
    const used = new Set(selected.map(candidate => candidate.hex.toLowerCase()))
    const nearest = anchorDistances?.slice()
    const updateNearest = (accepted: LabCandidate): void => {
      if (!nearest) return
      for (let index = 0; index < corpus.length; index++) {
        if (diagnostics) diagnostics.pairDistanceChecks++
        nearest[index] = Math.min(nearest[index]!, distance(corpus[index]!.lab, accepted.lab))
      }
    }
    if (second) updateNearest(second)

    while (selected.length < targets.length) {
      let best: LabCandidate | undefined
      let bestMin = -1
      let bestTargetDistance = Infinity
      const target = hexToOklab(targets[selected.length]!)
      for (let index = 0; index < corpus.length; index++) {
        const candidate = corpus[index]!
        if (used.has(candidate.hex.toLowerCase())) continue
        if (diagnostics) diagnostics.candidateEvaluations++
        let min = nearest?.[index] ?? Infinity
        if (!nearest) {
          for (const accepted of selected) {
            if (diagnostics) diagnostics.pairDistanceChecks++
            min = Math.min(min, distance(candidate.lab, accepted.lab))
          }
        }
        if (target && labelInk !== undefined && diagnostics) diagnostics.pairDistanceChecks++
        const targetDistance = target ? distance(candidate.lab, target) : 0
        if (min > bestMin + 1e-12 || (Math.abs(min - bestMin) <= 1e-12 && targetDistance < bestTargetDistance)) {
          best = candidate
          bestMin = min
          bestTargetDistance = targetDistance
        }
      }
      if (!best) return targets
      selected.push(best)
      used.add(best.hex.toLowerCase())
      updateNearest(best)
    }
    return selected.map(candidate => candidate.hex)
  }
  const first = pack()
  if (labelInk === undefined) return first
  let bestScore = measuredPairwiseMinimum(first, diagnostics)
  if (bestScore >= MIN_SLICE_DELTA_E) return first
  let best = first
  // A text-contrast constraint narrows the gamut. The first greedy packing
  // can strand a final peer despite sufficient room elsewhere. Retain the
  // accent anchor and try each of its at most 23 already-packed peers as the
  // second seed; all restarts reuse this one finite candidate corpus.
  for (const hex of first.slice(2)) {
    const lab = hexToOklab(hex)
    if (!lab) continue
    if (diagnostics) diagnostics.pairDistanceChecks++
    if (distance(anchor.lab, lab) < MIN_SLICE_DELTA_E) continue
    const retry = pack({ hex, lab })
    const score = measuredPairwiseMinimum(retry, diagnostics)
    if (score >= MIN_SLICE_DELTA_E) return retry
    if (score > bestScore) { best = retry; bestScore = score }
  }
  // Refine a stranded packing without moving its accent anchor. Candidate
  // distances to the at-most-24 selected colors are retained locally; moving
  // one color updates only its column, rather than recomputing the full set.
  const selected = best.map(hex => ({ hex, lab: hexToOklab(hex)! }))
  const width = selected.length
  const distances = new Float64Array(corpus.length * width)
  const updateColumn = (column: number): void => {
    for (let index = 0; index < corpus.length; index++) {
      if (diagnostics) diagnostics.pairDistanceChecks++
      distances[index * width + column] = distance(corpus[index]!.lab, selected[column]!.lab)
    }
  }
  for (let column = 0; column < width; column++) updateColumn(column)
  for (let round = 0; round < GUARANTEED_DELTA_E_MAX; round++) {
    let changed = false
    for (let column = 1; column < width; column++) {
      let nearest = Infinity
      for (let other = 0; other < width; other++) if (other !== column) {
        if (diagnostics) diagnostics.pairDistanceChecks++
        nearest = Math.min(nearest, distance(selected[column]!.lab, selected[other]!.lab))
      }
      let replacement: LabCandidate | undefined
      for (let index = 0; index < corpus.length; index++) {
        if (diagnostics) diagnostics.candidateEvaluations++
        let min = Infinity
        for (let other = 0; other < width; other++) if (other !== column) {
          min = Math.min(min, distances[index * width + other]!)
          if (min <= nearest + 1e-12) break
        }
        if (min > nearest + 1e-12) { nearest = min; replacement = corpus[index]! }
      }
      if (replacement) {
        selected[column] = replacement
        updateColumn(column)
        changed = true
      }
    }
    const colors = selected.map(candidate => candidate.hex)
    if (measuredPairwiseMinimum(colors, diagnostics) >= MIN_SLICE_DELTA_E) return colors
    if (!changed) break
  }
  return selected.map(candidate => candidate.hex)
}

/** Keep large-count generation linear while avoiding obvious repeated fills.
 * This is best-effort only; no perceptual floor is claimed above 24 slices. */
function dedupeBestEffort(colors: string[], bg: string | undefined, darkBg: boolean, diagnostics?: CategoricalPaletteDiagnostics, labelInk?: string, candidates?: () => LabCandidate[]): string[] {
  const used = new Set<string>()
  return colors.map((hex, index) => {
    if (diagnostics) diagnostics.tailItems++
    if (!used.has(hex.toLowerCase())) {
      used.add(hex.toLowerCase())
      return hex
    }
    const base = hexToOklch(hex)
    if (base) {
      for (let attempt = 1; attempt <= 24; attempt++) {
        if (diagnostics) diagnostics.candidateEvaluations++
        const candidate = ensureBgContrast(
          {
            ...base,
            L: clampL(base.L + (attempt % 2 === 0 ? 1 : -1) * Math.ceil(attempt / 2) * 0.008),
            h: (base.h + attempt * 137.508 + index * 0.01) % 360,
          },
          bg,
          darkBg,
          diagnostics,
          labelInk,
          candidates,
        )
        if (!used.has(candidate.toLowerCase())) {
          used.add(candidate.toLowerCase())
          return candidate
        }
      }
    }
    return hex
  })
}
