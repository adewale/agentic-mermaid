import { chromium } from 'playwright'

const browser = await chromium.launch()

// a representative spread across light + dark, to verify the logo and the grain
// stay constant while everything else re-skins.
const themes = [
  'pine',
  'zinc-light', 'github-light', 'solarized-light', 'tufte', 'salmon',
  'github-dark', 'tokyo-night', 'catppuccin-mocha', 'dracula', 'nord', 'tufte-dark',
]

for (const t of themes) {
  const ctx = await browser.newContext({ viewport: { width: 1040, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  await ctx.addInitScript(`try { localStorage.setItem('am-theme', '${t}') } catch (e) {}`)
  const page = await ctx.newPage()
  await page.goto(`file://${process.cwd()}/mockups/home.html`, { waitUntil: 'load' })
  await page.waitForTimeout(250)
  await page.screenshot({ path: `mockups/shot-theme-${t}.png`, fullPage: true })
  await ctx.close()
  console.log('theme', t)
}

// the dropdown open, to show the grouped, scrollable switcher UI
{
  const ctx = await browser.newContext({ viewport: { width: 1040, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(`file://${process.cwd()}/mockups/home.html`, { waitUntil: 'load' })
  await page.waitForTimeout(200)
  await page.click('.theme-btn')
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'mockups/shot-theme-menu.png', clip: { x: 0, y: 0, width: 1040, height: 640 } })
  await ctx.close()
  console.log('menu')
}

await browser.close()
console.log('done')
