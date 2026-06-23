import { chromium } from 'playwright'

// Capture one page (dark, the only theme). Usage: bun run mockups/cap.ts <name> [width]
const name = process.argv[2]
const width = Number(process.argv[3] ?? 1040)
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
const page = await ctx.newPage()
await page.goto(`file://${process.cwd()}/mockups/${name}.html`, { waitUntil: 'load' })
await page.waitForTimeout(150)
await page.screenshot({ path: `mockups/shot-${name}.png`, fullPage: true })
await browser.close()
console.log('shot', name)
