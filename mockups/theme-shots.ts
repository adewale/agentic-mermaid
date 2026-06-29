import { chromium } from 'playwright'

const browser = await chromium.launch()

// Legacy visual-snapshot helper. The public site no longer exposes a global
// theme switcher; diagram theme selection lives inside the real editor, so this
// script now captures representative static mockup surfaces only.
const pages = [
  { name: 'home', file: 'home.html', width: 1040, height: 1000 },
  { name: 'gallery', file: 'gallery.html', width: 1120, height: 1000 },
  { name: 'editor', file: 'editor.html', width: 1040, height: 1000 },
]

for (const p of pages) {
  const ctx = await browser.newContext({
    viewport: { width: p.width, height: p.height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  await page.goto(`file://${process.cwd()}/mockups/${p.file}`, { waitUntil: 'load' })
  await page.waitForTimeout(250)
  await page.screenshot({ path: `mockups/shot-${p.name}.png`, fullPage: true })
  await ctx.close()
  console.log('shot', p.name)
}

await browser.close()
console.log('done')
