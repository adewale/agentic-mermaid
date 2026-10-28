import { join } from 'node:path'

/** Probe the UI choice and share restoration separately: an SVG can be a
 * silent fallback to another theme, so its presence is insufficient proof. */
export async function probeModernThemes(page, catalog, url, screenshots) {
  const themes = [], themeSharing = []
  const picker = page.locator('button:has(svg.lucide-palette)')
  const preview = page.locator('div.p-12 > svg')
  const identify = async () => {
    const name = (await picker.textContent())?.trim()
    return { name, id: catalog.find(theme => theme.name === name)?.id ?? null }
  }
  for (const theme of catalog) {
    let shared
    try {
      await page.goto(url)
      await preview.waitFor()
      const active = await identify(), before = await preview.getAttribute('id')
      await picker.click()
      await page.getByRole('button', { name: theme.name, exact: true }).last().click()
      await page.waitForFunction(({ name, before, changed }) => {
        const button = document.querySelector('button:has(svg.lucide-palette)')
        const svg = document.querySelector('div.p-12 > svg')
        return button?.textContent?.trim() === name && svg && (!changed || svg.id !== before)
      }, { name: theme.name, before, changed: active.id !== theme.id })
      const selected = await identify()
      if (selected.id !== theme.id) throw new Error(`Requested ${theme.id}, selected ${selected.id}`)
      themes.push({ theme: theme.id, activeTheme: selected.id, activeName: selected.name, ok: true })
      if (screenshots && ['linearLight', 'linearDark', 'ghibli', 'handDrawn'].includes(theme.id)) {
        await page.screenshot({ path: join(screenshots, `theme-${theme.id}.png`) })
      }
      await page.getByTitle('Share', { exact: true }).click()
      shared = await page.evaluate(() => navigator.clipboard.readText())
    } catch (error) {
      if (!themes.some(row => row.theme === theme.id)) themes.push({ theme: theme.id, ok: false, error: String(error) })
      themeSharing.push({ theme: theme.id, ok: false, error: String(error) })
      continue
    }
    try {
      const sharedTheme = new URL(shared).searchParams.get('theme')
      await page.goto(shared)
      await preview.waitFor()
      const restored = await identify()
      themeSharing.push({ theme: theme.id, sharedTheme, restoredTheme: restored.id, restoredName: restored.name,
        ok: sharedTheme === theme.id && restored.id === theme.id })
    } catch (error) { themeSharing.push({ theme: theme.id, ok: false, error: String(error) }) }
  }
  return { themes, themeSharing }
}
