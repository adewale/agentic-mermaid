/**
 * Chrome token lockstep — the editor app shell and the public site are meant to
 * share one brand system. Three source files each carry the values and, until
 * this test, kept in sync only by "keep in lockstep" comments (which is how a
 * 12% vs 13% hairline drift shipped):
 *
 *   website/source/assets/styles.css   :root theme triplet + functional hues
 *   editor/css/variables.css           --t-* triplet + functional hues
 *   editor/js/rendering.js             chromeThemeColors() light/dark triplets
 *
 * This test extracts the shared tokens from all three and asserts equality, so
 * the next drift fails CI instead of shipping.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')
const siteCss = readFileSync(join(REPO, 'website/source/assets/styles.css'), 'utf8')
const editorCss = readFileSync(join(REPO, 'editor/css/variables.css'), 'utf8')
const renderingJs = readFileSync(join(REPO, 'editor/js/rendering.js'), 'utf8')

/** First `--name: <hex>` declaration in a block of CSS text. */
function cssHex(css: string, name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`))
  expect(Boolean(m), `--${name} not found`).toBe(true)
  return m![1]!.toUpperCase()
}

/** The `[data-scheme="dark"]` block of a stylesheet. */
function darkBlock(css: string): string {
  const m = css.match(/\[data-scheme="dark"\]\s*{([^}]*)}/)
  expect(Boolean(m), 'dark scheme block not found').toBe(true)
  return m![1]!
}

describe('editor and site chrome share one brand system', () => {
  test('light chrome triplet matches across site CSS, editor CSS, and rendering.js', () => {
    const site = { bg: cssHex(siteCss, 'bg'), fg: cssHex(siteCss, 'fg'), accent: cssHex(siteCss, 'accent') }
    const editor = { bg: cssHex(editorCss, 't-bg'), fg: cssHex(editorCss, 't-fg'), accent: cssHex(editorCss, 't-accent') }
    expect(editor).toEqual(site)

    const js = renderingJs.match(/:\s*{\s*bg:\s*"(#[0-9a-fA-F]{6})",\s*fg:\s*"(#[0-9a-fA-F]{6})",\s*accent:\s*"(#[0-9a-fA-F]{6})"\s*}/)
    expect(Boolean(js), 'light triplet in chromeThemeColors()').toBe(true)
    expect({ bg: js![1]!.toUpperCase(), fg: js![2]!.toUpperCase(), accent: js![3]!.toUpperCase() }).toEqual(site)
  })

  test('brand chip tokens match', () => {
    expect(cssHex(editorCss, 'brand-pine')).toBe(cssHex(siteCss, 'brand-pine'))
    expect(cssHex(editorCss, 'brand-on')).toBe(cssHex(siteCss, 'brand-on'))
  })

  test('functional hues match in both polarities', () => {
    for (const name of ['success', 'info', 'warn', 'danger']) {
      expect(cssHex(editorCss, name), `light --${name}`).toBe(cssHex(siteCss, name))
      expect(cssHex(darkBlock(editorCss), name), `dark --${name}`).toBe(cssHex(darkBlock(siteCss), name))
    }
  })

  test('success stays a distinct hue from the pine accent (shipped hex, both polarities)', () => {
    // OkLCH hue via the standard sRGB→Oklab pipeline. The accent and success
    // are both greens; under ~20° apart they read as one colour (worse for
    // deuteranopes), which defeats "functional colour carries meaning".
    const hue = (hex: string): number => {
      const [r, g, b] = [0, 2, 4].map((i) => {
        const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }) as [number, number, number]
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
      const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
      const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
      const h = (Math.atan2(bb, a) * 180) / Math.PI
      return h < 0 ? h + 360 : h
    }
    const lightGap = Math.abs(hue(cssHex(siteCss, 'accent')) - hue(cssHex(siteCss, 'success')))
    expect(lightGap).toBeGreaterThanOrEqual(20)
    const darkAccent = renderingJs.match(/\?\s*{\s*bg:\s*"#[0-9a-fA-F]{6}",\s*fg:\s*"#[0-9a-fA-F]{6}",\s*accent:\s*"(#[0-9a-fA-F]{6})"/)
    expect(Boolean(darkAccent)).toBe(true)
    const darkGap = Math.abs(hue(darkAccent![1]!.toUpperCase()) - hue(cssHex(darkBlock(siteCss), 'success')))
    expect(darkGap).toBeGreaterThanOrEqual(20)
  })

  test('shared scale tokens match: radii, motion, hairline mix', () => {
    for (const name of ['radius-sm', 'radius-md', 'radius-lg', 'radius-pill', 'dur-ui', 'dur-control', 'dur-press']) {
      const val = (css: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim()
      expect(val(editorCss), `--${name}`).toBe(val(siteCss))
    }
    // ease-out: same cubic-bezier both sides
    const ease = (css: string) => css.match(/--ease-out:\s*(cubic-bezier\([^)]*\))/)?.[1]
    expect(ease(editorCss)).toBe(ease(siteCss))
    // hairline: editor --border and site --line use the same fg mix percentage
    const mixPct = (css: string, name: string) => css.match(new RegExp(`--${name}:\\s*color-mix\\(in srgb, var\\(--[a-z-]*fg\\) (\\d+)%`))?.[1]
    expect(mixPct(editorCss, 'border'), 'editor hairline %').toBe(mixPct(siteCss, 'line'))
  })
})
