import { chromium } from 'playwright'
import { writeFileSync, unlinkSync } from 'fs'

const cwd = process.cwd()
const url = (p: string) => `file://${cwd}/mockups/${p}`
const browser = await chromium.launch()
const temp: string[] = []

// build a labelled vertical filmstrip from already-captured frame files
async function filmstrip(frames: { src: string; cap: string }[], out: string, frameW = 760) {
  const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css">
<body style="margin:0"><div style="background:var(--paper); padding:24px; display:flex; flex-direction:column; gap:18px; width:${frameW + 2}px;">
${frames.map((f, i) => `<div>
  <div style="font-family:var(--mono); font-size:12px; color:var(--ink-faint); margin-bottom:6px;">${i + 1} &middot; ${f.cap}</div>
  <img src="${f.src}" style="width:${frameW}px; height:auto; display:block; border:1px solid var(--line); border-radius:10px;">
</div>`).join('')}
</div></body>`
  writeFileSync(`${cwd}/mockups/_filmstrip.html`, html); temp.push('_filmstrip.html')
  const ctx = await browser.newContext({ deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(url('_filmstrip.html'), { waitUntil: 'load' })
  await page.waitForTimeout(150)
  await page.screenshot({ path: `mockups/${out}`, fullPage: true })
  await ctx.close()
  console.log('built', out)
}

// 1) interaction-states sheet, light + dark
for (const [variant, cs] of [['light', 'light'], ['dark', 'dark']] as const) {
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1000 }, deviceScaleFactor: 2, colorScheme: cs, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(url('states.html'), { waitUntil: 'load' })
  await page.waitForTimeout(150)
  await page.screenshot({ path: `mockups/shot-states-${variant}.png`, fullPage: true })
  await ctx.close()
  console.log('shot states', variant)
}

// 2) theme crossfade — frames of the nav+hero region across one toggle (motion enabled)
{
  const clip = { x: 0, y: 0, width: 1320, height: 520 }
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  await page.goto(url('home.html'), { waitUntil: 'load' })
  await page.waitForTimeout(800)                                   // entrance finished
  await page.screenshot({ path: 'mockups/_t1.png', clip }); temp.push('_t1.png')
  await page.click('.iconbtn[aria-label="Toggle dark mode"]')
  await page.waitForTimeout(80);  await page.screenshot({ path: 'mockups/_t2.png', clip }); temp.push('_t2.png')
  await page.waitForTimeout(220); await page.screenshot({ path: 'mockups/_t3.png', clip }); temp.push('_t3.png')
  await ctx.close()
  await filmstrip([
    { src: '_t1.png', cap: 'light' },
    { src: '_t2.png', cap: 'mid-transition (~90ms into 220ms ease-out)' },
    { src: '_t3.png', cap: 'dark (settled)' },
  ], 'shot-motion-theme.png')
}

// 3) entrance stagger — frames captured during the load animation
{
  const clip = { x: 0, y: 0, width: 1320, height: 1080 }
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 1120 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  await page.goto(url('home.html'), { waitUntil: 'commit' })
  await page.waitForTimeout(120); await page.screenshot({ path: 'mockups/_e1.png', clip }); temp.push('_e1.png')
  await page.waitForTimeout(170); await page.screenshot({ path: 'mockups/_e2.png', clip }); temp.push('_e2.png')
  await page.waitForTimeout(320); await page.screenshot({ path: 'mockups/_e3.png', clip }); temp.push('_e3.png')
  await ctx.close()
  await filmstrip([
    { src: '_e1.png', cap: '~120ms — hero and first cards rising/fading in' },
    { src: '_e2.png', cap: '~290ms — stagger mid-flight' },
    { src: '_e3.png', cap: '~610ms — settled' },
  ], 'shot-motion-entrance.png')
}

await browser.close()
for (const f of temp) { try { unlinkSync(`${cwd}/mockups/${f}`) } catch {} }
console.log('done')
