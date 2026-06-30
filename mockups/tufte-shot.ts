import { chromium } from 'playwright'

const browser = await chromium.launch()
// wide enough for the asymmetric two-column Tufte measure
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
const page = await ctx.newPage()
await page.goto(`file://${process.cwd()}/mockups/tufte-max.html`, { waitUntil: 'load' })
await page.waitForTimeout(250)
await page.screenshot({ path: 'mockups/shot-tufte-max.png', fullPage: true })
await ctx.close()
await browser.close()
console.log('done')
