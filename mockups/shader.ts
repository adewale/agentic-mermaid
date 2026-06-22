import { chromium } from 'playwright'
import { writeFileSync, unlinkSync } from 'fs'

const cwd = process.cwd()
const url = (p: string) => `file://${cwd}/mockups/${p}`
const browser = await chromium.launch()
const temp: string[] = []

// big mark across the trident bloom (deterministic phases via window.__SHADER_TIME__)
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 760 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  await page.goto(url('shader-demo.html'), { waitUntil: 'load' })
  await page.waitForTimeout(300)
  const box = await page.locator('.demo-big').boundingBox()
  const clip = { x: Math.round(box!.x), y: Math.round(box!.y), width: Math.round(box!.width), height: Math.round(box!.height) }
  const phases = [
    { t: 6.16, cap: 'resting — overlooked' },
    { t: 1.10, cap: 'surfacing' },
    { t: 1.67, cap: 'there' },
    { t: 2.50, cap: 'dissolving' },
  ]
  for (let i = 0; i < phases.length; i++) {
    await page.evaluate((t) => { (window as any).__SHADER_TIME__ = t }, phases[i].t)
    await page.waitForTimeout(140)
    await page.screenshot({ path: `mockups/_s${i}.png`, clip }); temp.push(`_s${i}.png`)
  }
  await ctx.close()

  const frames = phases.map((p, i) => `<figure style="margin:0">
    <img src="_s${i}.png" style="width:200px;height:200px;display:block;border-radius:26px;border:1px solid var(--line);">
    <figcaption style="font-family:var(--mono);font-size:12px;color:var(--ink-faint);margin-top:8px;text-align:center;">${p.cap}</figcaption>
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

// the mark in context — pinned to the resting phase, so the crop shows what most people see
{
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 200 }, deviceScaleFactor: 3, colorScheme: 'light', reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  await page.goto(url('home.html'), { waitUntil: 'load' })
  await page.evaluate(() => { (window as any).__SHADER_TIME__ = 6.16 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'mockups/shot-shader-context.png', clip: { x: 16, y: 8, width: 320, height: 46 } })
  await ctx.close()
  console.log('built shot-shader-context.png')
}

await browser.close()
for (const f of temp) { try { unlinkSync(`${cwd}/mockups/${f}`) } catch {} }
console.log('done')
