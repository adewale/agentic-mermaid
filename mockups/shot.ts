import { chromium } from 'playwright'

const pages = ['home', 'editor', 'agents-harnesses']
const browser = await chromium.launch()

async function shoot(variant: string, opts: Parameters<typeof browser.newContext>[0]) {
  const ctx = await browser.newContext(opts)
  for (const p of pages) {
    const page = await ctx.newPage()
    await page.goto(`file://${process.cwd()}/mockups/${p}.html`, { waitUntil: 'load' })
    await page.waitForTimeout(250)
    await page.screenshot({ path: `mockups/shot-${p}-${variant}.png`, fullPage: true })
    await page.close()
    console.log('shot', p, variant)
  }
  await ctx.close()
}

// desktop light + dark (theme via emulated prefers-color-scheme), then narrow mobile
await shoot('light',  { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'light' })
await shoot('dark',   { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, colorScheme: 'dark' })
await shoot('mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light', isMobile: true, hasTouch: true })

await browser.close()
console.log('done')
