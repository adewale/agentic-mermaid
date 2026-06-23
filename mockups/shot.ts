import { chromium } from 'playwright'

const pages = ['home', 'editor', 'agents-harnesses', 'docs-article']
const browser = await chromium.launch()

async function shoot(suffix: string, opts: Parameters<typeof browser.newContext>[0]) {
  const ctx = await browser.newContext(opts)
  for (const p of pages) {
    const page = await ctx.newPage()
    await page.goto(`file://${process.cwd()}/mockups/${p}.html`, { waitUntil: 'load' })
    await page.waitForTimeout(250)
    await page.screenshot({ path: `mockups/shot-${p}${suffix}.png`, fullPage: true })
    await page.close()
    console.log('shot', p, suffix || 'desktop')
  }
  await ctx.close()
}

// dark is the only theme; reduced-motion freezes the mark's settle for crisp stills
await shoot('', { viewport: { width: 1040, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
await shoot('-mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: true, hasTouch: true })

await browser.close()
console.log('done')
