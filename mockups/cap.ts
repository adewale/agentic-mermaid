import { chromium } from 'playwright'

// Capture one page in light + dark. Usage: bun run mockups/cap.ts <name> [width]
const name = process.argv[2]
const width = Number(process.argv[3] ?? 1000)
const browser = await chromium.launch()
for (const [variant, colorScheme] of [['light', 'light'], ['dark', 'dark']] as const) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(`file://${process.cwd()}/mockups/${name}.html`, { waitUntil: 'load' })
  await page.waitForTimeout(150)
  await page.screenshot({ path: `mockups/shot-${name}-${variant}.png`, fullPage: true })
  await ctx.close()
  console.log('shot', name, variant)
}
await browser.close()
