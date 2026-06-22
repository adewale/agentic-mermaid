import { chromium } from 'playwright'

const pages = ['home', 'editor', 'agents-harnesses']
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })

for (const p of pages) {
  const page = await ctx.newPage()
  await page.goto(`file://${process.cwd()}/mockups/${p}.html`, { waitUntil: 'load' })
  await page.waitForTimeout(250)
  await page.screenshot({ path: `mockups/shot-${p}.png`, fullPage: true })
  await page.close()
  console.log('shot', p)
}

await browser.close()
console.log('done')
