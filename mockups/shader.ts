import { chromium } from 'playwright'
import { writeFileSync, unlinkSync } from 'fs'

const cwd = process.cwd()
const url = (p: string) => `file://${cwd}/mockups/${p}`
const browser = await chromium.launch()
const temp: string[] = []

// the node-edge logo with a signal travelling the routed edge — four phases A -> bend -> B
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  await page.goto(url('shader-demo.html'), { waitUntil: 'load' })
  await page.waitForTimeout(300)
  const box = await page.locator('.demo-big').boundingBox()
  const clip = { x: Math.round(box!.x), y: Math.round(box!.y), width: Math.round(box!.width), height: Math.round(box!.height) }
  const phases = [
    { t: 0.0, cap: 'resting' },
    { t: 2.84, cap: 'top rank' },
    { t: 4.17, cap: 'middle rank' },
    { t: 5.49, cap: 'bottom rank' },
  ]
  for (let i = 0; i < phases.length; i++) {
    await page.evaluate((t) => { (window as any).__SHADER_TIME__ = t }, phases[i].t)
    await page.waitForTimeout(140)
    await page.screenshot({ path: `mockups/_s${i}.png`, clip }); temp.push(`_s${i}.png`)
  }
  await ctx.close()

  const frames = phases.map((ph, i) => `<figure style="margin:0">
    <img src="_s${i}.png" style="width:200px;height:200px;display:block;border-radius:26px;border:1px solid var(--line);">
    <figcaption style="font-family:var(--mono);font-size:12px;color:var(--ink-faint);margin-top:8px;text-align:center;">${ph.cap}</figcaption>
  </figure>`).join('')
  writeFileSync(`${cwd}/mockups/_strip.html`, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="styles.css">
<body style="margin:0"><div style="display:flex;gap:18px;padding:24px;background:var(--paper);width:max-content;">${frames}</div></body>`)
  temp.push('_strip.html')
  const c2 = await browser.newContext({ viewport: { width: 980, height: 290 }, deviceScaleFactor: 2 })
  const p2 = await c2.newPage()
  await p2.goto(url('_strip.html'), { waitUntil: 'load' })
  await p2.waitForTimeout(150)
  await p2.screenshot({ path: 'mockups/shot-shader.png', fullPage: true })
  await c2.close()
  console.log('built shot-shader.png')
}

// the mark in context — the node-edge diagram in the real nav
{
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 200 }, deviceScaleFactor: 3, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  await page.goto(url('home.html'), { waitUntil: 'load' })
  await page.evaluate(() => { (window as any).__SHADER_TIME__ = 4.17 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'mockups/shot-shader-context.png', clip: { x: 16, y: 8, width: 320, height: 46 } })
  await ctx.close()
  console.log('built shot-shader-context.png')
}

await browser.close()
for (const f of temp) { try { unlinkSync(`${cwd}/mockups/${f}`) } catch {} }
console.log('done')
