import { escapeHtml, escapeAttr, makePreFocusable } from './html.ts'
import type { createSiteMetadata } from './metadata.ts'

export function createPageShell(packageVersion: string, agentDiscoveryLinks: (route: string) => string, GENERIC_EDITOR_HREF: string, metadata: ReturnType<typeof createSiteMetadata>) {
  const { socialMetaTags, structuredDataTags } = metadata
  function mastheadHtml(currentHref = '') {
    const links = [
      ['/about/', 'About', ''],
      ['/examples/', 'Examples', ''],
      ['/comparisons/', 'Comparisons', ''],
      ['/docs/', 'Docs', ''],
      ['https://github.com/adewale/agentic-mermaid', 'GitHub', ''],
      [GENERIC_EDITOR_HREF, 'Open editor', 'link-editor'],
    ] as const
    const nav = links
      .map(([href, label, cls]) => {
        const attrs = [cls ? `class="${cls}"` : '', currentHref === href ? 'aria-current="page"' : ''].filter(Boolean).join(' ')
        return `<a ${attrs ? attrs + ' ' : ''}href="${href}">${label}</a>`
      })
      .join('')
    return `<header class="masthead"><div class="bar"><a class="brand" href="/"><span class="mark"></span> Agentic&nbsp;Mermaid</a><nav class="links desktop-links" aria-label="Primary navigation">${nav}</nav><details class="nav-menu"><summary class="nav-toggle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>Menu</span></summary><nav id="site-navigation" class="links" aria-label="Primary navigation">${nav}</nav></details></div><hr></header>`
  }

  // One quiet footer on every document page: the trust signals an evaluating
  // engineer looks for (version, license, where to report a problem) plus the
  // pages that otherwise have no inbound link (design language). The editor is
  // app chrome and carries its own report-issue affordance instead.
  function siteFooterHtml() {
    return `<footer class="site-footer"><hr><div class="bar"><p>Agentic Mermaid v${packageVersion} · <a href="https://github.com/adewale/agentic-mermaid/blob/main/LICENSE">MIT</a> · <a href="https://github.com/adewale/agentic-mermaid">GitHub</a> · <a href="https://github.com/adewale/agentic-mermaid/issues">Report an issue</a> · <a href="https://github.com/adewale/agentic-mermaid/blob/main/CHANGELOG.md">Changelog</a> · <a href="/about/design/">Design language</a> · <a href="/llms.txt">llms.txt</a></p></div></footer>`
  }

  function addFooter(html: string) {
    if (html.includes('class="site-footer"')) return html
    return html.replace('</main>', '</main>\n' + siteFooterHtml())
  }

  // Single page header contract: h1 + lead, then an optional meta row
  // (e.g. "Updated · source · read time") and actions row. The public site is
  // deliberately document-first with no breadcrumb chrome (see the website
  // contract test — masthead nav is the only wayfinding the shell ships).
  function pageShell(title: string, lead: string, body: string, currentHref = '', meta = '', actions = '', route = '') {
    // Titles that already carry the brand (e.g. "About Agentic Mermaid") do not
    // get the suffix a second time.
    const fullTitle = title.includes('Agentic Mermaid') ? title : `${title} – Agentic Mermaid`
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="description" content="${escapeAttr(lead)}">
<title>${escapeHtml(fullTitle)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" type="image/x-icon">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/styles.css">
${agentDiscoveryLinks(route)}
${socialMetaTags(escapeAttr(fullTitle), escapeAttr(lead), route)}
${structuredDataTags(fullTitle, lead, route || '/')}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${mastheadHtml(currentHref)}
<main id="main" class="doc">
<section class="page-header">
<h1>${escapeHtml(title)}</h1>
<p class="lead">${escapeHtml(lead)}</p>
${meta ? `<p class="page-meta">${meta}</p>\n` : ''}${actions ? `<div class="page-actions">${actions}</div>\n` : ''}</section>
${makePreFocusable(body)}
</main>
${siteFooterHtml()}
<script src="/shader-mark.js"></script>
<script src="/theme.js"></script>
</body>
</html>`
  }

  return { mastheadHtml, addFooter, pageShell }
}
