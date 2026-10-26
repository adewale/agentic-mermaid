import { escapeAttr } from './html.ts'

export function createSiteMetadata(packageJson: { description: string; version: string }, siteOrigin: string) {
  // Social/canonical metadata. Keep the canonical public origin as the default so
  // local builds and production both ship complete entity-resolution metadata.
  // titleAttr/descriptionAttr must already be attribute-escaped by the caller.
  function socialMetaTags(titleAttr: string, descriptionAttr: string, route = '') {
    const tags = [`<meta property="og:title" content="${titleAttr}">`, `<meta property="og:description" content="${descriptionAttr}">`, '<meta property="og:type" content="website">', '<meta name="twitter:card" content="summary_large_image">']
    if (siteOrigin && route) {
      tags.push(`<link rel="canonical" href="${escapeAttr(siteOrigin + route)}">`, `<meta property="og:url" content="${escapeAttr(siteOrigin + route)}">`, `<meta property="og:image" content="${escapeAttr(siteOrigin + '/og-image.png')}">`)
    }
    return tags.join('\n')
  }

  // Head-injection step for mockup-derived pages (and the editor): reuse the
  // page's own <title> and meta description so the social card never drifts
  // from the visible page. Both are lifted from markup, so they are already
  // entity-escaped; only stray quotes need re-escaping for the attribute.
  function addSocialMeta(html: string, route = '') {
    if (html.includes('property="og:title"')) return html
    const title = (html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'Agentic Mermaid').trim().replace(/"/g, '&quot;')
    const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
    return html.replace('</head>', socialMetaTags(title, description, route) + '\n</head>')
  }

  function jsonLdScript(data: unknown) {
    return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
  }

  function decodeHtmlLite(s: string) {
    return s
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
  }

  function structuredDataTags(title = 'Agentic Mermaid', description = packageJson.description, route = '/') {
    const pageUrl = siteOrigin + (route || '/')
    const homeUrl = `${siteOrigin}/`
    const logoUrl = `${siteOrigin}/og-image.png`
    return jsonLdScript({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${homeUrl}#organization`,
          name: 'Agentic Mermaid',
          url: homeUrl,
          logo: logoUrl,
          description: 'Open-source Mermaid rendering, verification, and structured editing for coding agents.',
          sameAs: ['https://github.com/adewale/agentic-mermaid'],
          contactPoint: {
            '@type': 'ContactPoint',
            contactType: 'technical support',
            url: 'https://github.com/adewale/agentic-mermaid/issues',
          },
          address: {
            '@type': 'PostalAddress',
            addressCountry: 'US',
          },
        },
        {
          '@type': 'WebSite',
          '@id': `${homeUrl}#website`,
          name: 'Agentic Mermaid',
          url: homeUrl,
          description: packageJson.description,
          publisher: { '@id': `${homeUrl}#organization` },
        },
        {
          '@type': 'SoftwareApplication',
          '@id': `${homeUrl}#software`,
          name: 'Agentic Mermaid',
          url: homeUrl,
          description: packageJson.description,
          applicationCategory: 'DeveloperApplication',
          applicationSubCategory: 'Diagramming, MCP server, CLI, and library',
          operatingSystem: 'Cross-platform',
          softwareVersion: packageJson.version,
          codeRepository: 'https://github.com/adewale/agentic-mermaid',
          programmingLanguage: ['TypeScript', 'JavaScript'],
          runtimePlatform: ['Node.js', 'Bun', 'Cloudflare Workers'],
          isAccessibleForFree: true,
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
          featureList: ['Parse, verify, mutate, serialize, and render Mermaid diagrams', 'Deterministic SVG, PNG, ASCII, Unicode, and JSON layout output', 'Hosted and self-hosted MCP tools for agent workflows', 'Structured mutation operations for supported Mermaid families'],
          provider: { '@id': `${homeUrl}#organization` },
          sameAs: ['https://github.com/adewale/agentic-mermaid'],
        },
        {
          '@type': 'Service',
          '@id': `${homeUrl}#hosted-mcp`,
          name: 'Agentic Mermaid hosted MCP',
          serviceType: 'Model Context Protocol server',
          url: `${siteOrigin}/mcp`,
          description: 'Stateless Streamable HTTP MCP endpoint for rendering, verifying, describing, mutating, and building Mermaid diagrams.',
          provider: { '@id': `${homeUrl}#organization` },
          isRelatedTo: { '@id': `${homeUrl}#software` },
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
        },
        {
          '@type': 'WebPage',
          '@id': `${pageUrl}#webpage`,
          url: pageUrl,
          name: title,
          description,
          isPartOf: { '@id': `${homeUrl}#website` },
          primaryImageOfPage: logoUrl,
          about: { '@id': `${homeUrl}#software` },
          speakable: {
            '@type': 'SpeakableSpecification',
            cssSelector: ['h1', '.lead', '.agent-entrypoints'],
          },
        },
        // FAQPage markup is scoped to /about/ (the page whose visible FAQ section
        // it describes): Google's guideline requires the Q&A to be visible on the
        // page carrying the markup, and stamping it site-wide risks it being
        // ignored as duplicate structured data.
        ...(route === '/about/'
          ? [
              {
                '@type': 'FAQPage',
                '@id': `${homeUrl}#faq`,
                mainEntity: [
                  {
                    '@type': 'Question',
                    name: 'What is Agentic Mermaid?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'Agentic Mermaid is an open-source Mermaid runtime for agents. It parses, verifies, mutates, serializes, and renders diagrams without a browser.',
                    },
                  },
                  {
                    '@type': 'Question',
                    name: 'How should an agent use Agentic Mermaid?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'Use the local library, CLI, or MCP server. Parse source first, narrow to the diagram family, apply structured mutations when available, verify, then serialize or render.',
                    },
                  },
                  {
                    '@type': 'Question',
                    name: 'Where is the hosted MCP endpoint?',
                    acceptedAnswer: {
                      '@type': 'Answer',
                      text: 'The hosted stateless Streamable HTTP MCP endpoint is https://agentic-mermaid.dev/mcp, with a standard discovery alias at https://agentic-mermaid.dev/.well-known/mcp.',
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    })
  }

  function addStructuredData(html: string, route = '') {
    if (html.includes('"@id":"https://agentic-mermaid.dev/#software"')) return html
    const title = decodeHtmlLite((html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? 'Agentic Mermaid').trim())
    const description = decodeHtmlLite(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? packageJson.description)
    return html.replace('</head>', structuredDataTags(title, description, route || '/') + '\n</head>')
  }

  return { socialMetaTags, structuredDataTags, addSocialMeta, addStructuredData }
}
