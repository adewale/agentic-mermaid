/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

/**
 * Investigate blue color persistence: screenshot every sample under Tufte theme,
 * and scan all SVG elements for blue-ish computed colors.
 */

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join(import.meta.dir, '..', 'assets', 'theme-screenshots')
mkdirSync(outDir, { recursive: true })

const url = `file://${join(import.meta.dir, '..', 'examples', 'showcases', 'new-diagrams.html')}`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(5000)

// Apply Tufte theme
await page.evaluate(() => {
  const pills = document.querySelectorAll('.theme-pill') as NodeListOf<HTMLElement>
  for (const pill of pills) {
    if (pill.dataset.theme === 'tufte') { pill.click(); break }
  }
})
await page.waitForTimeout(2000)

// Screenshot each sample
const sampleCount = await page.locator('.sample:not(.sample-hero)').count()
console.log(`${sampleCount} samples found\n`)

for (let i = 0; i < sampleCount; i++) {
  const sample = page.locator('.sample:not(.sample-hero)').nth(i)
  await sample.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await sample.screenshot({ path: join(outDir, `blue-check-${i}.png`) })
}

// Now scan for blue-ish colors in computed styles
const blueReport = await page.evaluate(() => {
  const results: any[] = []

  function isBlueish(color: string): boolean {
    // Parse rgb/rgba values
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!match) return false
    const r = parseInt(match[1]!)
    const g = parseInt(match[2]!)
    const b = parseInt(match[3]!)
    // Blue-ish: blue channel significantly higher than red, and not gray
    return b > 150 && b > r * 1.5 && b > g * 1.3 && (b - r) > 60
  }

  document.querySelectorAll('.sample:not(.sample-hero)').forEach((sample, sampleIdx) => {
    const h2 = sample.querySelector('h2')?.textContent ?? `sample-${sampleIdx}`
    const svgContainer = sample.querySelector('.svg-container')
    if (!svgContainer) return

    const allEls = svgContainer.querySelectorAll('*')
    const blueEls: any[] = []

    allEls.forEach((el) => {
      const cs = getComputedStyle(el)
      const props = ['color', 'fill', 'stroke', 'backgroundColor', 'borderColor']
      for (const prop of props) {
        const val = cs.getPropertyValue(prop)
        if (val && isBlueish(val)) {
          blueEls.push({
            tag: el.tagName.toLowerCase(),
            class: el.getAttribute('class')?.slice(0, 60) ?? '',
            prop,
            value: val,
            text: el.textContent?.slice(0, 30) ?? '',
          })
        }
      }
    })

    if (blueEls.length > 0) {
      results.push({ sampleIdx, title: h2.slice(0, 50), blueCount: blueEls.length, elements: blueEls.slice(0, 10) })
    }
  })

  return results
})

if (blueReport.length === 0) {
  console.log('No blue elements found under Tufte theme.')
} else {
  console.log(`Found blue elements in ${blueReport.length} samples:\n`)
  for (const r of blueReport) {
    console.log(`[${r.sampleIdx}] ${r.title} — ${r.blueCount} blue elements`)
    for (const el of r.elements) {
      console.log(`    <${el.tag} class="${el.class}"> ${el.prop}=${el.value}`)
    }
    console.log()
  }
}

await browser.close()
