import { chromium } from 'playwright'

const browser = await chromium.launch()
const themes = ['pine', 'paper', 'nord', 'dracula', 'solarized', 'github']

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

// the dropdown open, to show the switcher UI
{
  const ctx = await browser.newContext({ viewport: { width: 1040, height: 760 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(`file://${process.cwd()}/mockups/home.html`, { waitUntil: 'load' })
  await page.waitForTimeout(200)
  await page.click('.theme-btn')
  await page.waitForTimeout(250)
  await page.screenshot({ path: 'mockups/shot-theme-menu.png', clip: { x: 0, y: 0, width: 1040, height: 440 } })
  await ctx.close()
  console.log('menu')
}

await browser.close()
console.log('done')
