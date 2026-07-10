---
name: Agentic Mermaid
description: Local-first, agent-native Mermaid rendering and typed diagram editing.
colors:
  paper: "#F5F0E4"
  ink: "#221E16"
  accent-terracotta: "#9A4A24"
  brand-pine: "#6FC2A2"
  brand-on-pine: "#0A4434"
  surface: "#EDE7DB"
  line: "#D8D0C1"
typography:
  display:
    fontFamily: "Charter, Bitstream Charter, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "clamp(2.7rem, 6.5vw, 4rem)"
    fontWeight: 600
    lineHeight: 1.03
    letterSpacing: "-0.022em"
  heading:
    fontFamily: "Charter, Bitstream Charter, Iowan Old Style, Palatino Linotype, Palatino, Georgia, serif"
    fontSize: "clamp(2.2rem, 4.2vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.018em"
  body:
    fontFamily: "Avenir Next, Avenir, Segoe UI, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "SFMono-Regular, SF Mono, Menlo, Consolas, DejaVu Sans Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 650
    lineHeight: 1.35
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  xxl: "56px"
components:
  button-primary:
    backgroundColor: "{colors.accent-terracotta}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
---
# Design System: Agentic Mermaid

## Overview

**Creative North Star: "A standards manual attached to a capable workbench."**

Agentic Mermaid’s public site is a document-first brand surface for engineers, documentation authors, and coding agents. It should feel precise, calm, and mechanically trustworthy: a readable manual with enough workbench affordance that visitors can immediately copy an agent prompt, open the editor, install locally, or inspect the machine-readable contract.

The system is restrained by design. Proof diagrams, source snippets, warning codes, and local-first constraints carry the brand; decoration does not. The site must never imply hosted Code Mode, arbitrary execution, or a production render API.

**Key Characteristics:**
- Sparse Paper-and-ink surface with one terracotta action accent and an isolated pine logo mark.
- Serif headings for manual authority; system/humanist sans for controls and prose; mono only for code, labels, and traces.
- Flat panels with hairline borders, not glossy cards or SaaS shadows.
- Concrete diagrams, commands, warnings, and source snippets instead of AI-magic claims.

## Colors

The palette is restrained: Paper, ink, one terracotta action/link accent, and a separate pine logo chip that renderer themes never retint.

### Primary
- **Paper Ground**: the page background. It is a committed product surface, not generic beige decoration.
- **Terracotta Action**: primary actions, links, focus rings, and selected states. Use it sparingly so it remains meaningful.
- **Pine Mark**: logo chip and shader fallback only. Do not use it as a general CTA color.

### Neutral
- **Ink**: headings and body text.
- **Soft Ink / Faint Ink**: supporting prose, labels, metadata, and table assistance.
- **Surface / Line**: panels, code blocks, tables, dividers, and grouped proof artifacts.

### Named Rules
**The Local-First Honesty Rule.** Color may highlight local commands, warnings, and agent routes, but it must never imply a hosted execution surface.

**The Isolated Mark Rule.** Brand mark tokens are isolated from renderer themes and page scheme tokens. Theme changes may retint diagrams, never the shell identity.

## Typography

**Display Font:** Charter / Iowan / Palatino-family serif stack.
**Body Font:** Avenir Next / Segoe UI / system sans stack.
**Label/Mono Font:** SF Mono / Menlo / Consolas stack.

**Character:** Standards manual, calibration sheet, and instrument panel. The serif gives the site a document spine; the sans and mono keep tasks readable and exact.

### Hierarchy
- **Display** (600, `clamp(2.7rem, 6.5vw, 4rem)`, 1.03): homepage headline only.
- **Heading** (600, fluid bounded scale, 1.08): page titles and major sections.
- **Subheading** (700, `1.25rem`, 1.25): local groups and card headings.
- **Body** (400, `1.0625rem`, 1.6): prose, capped around 65–75 characters where it reads as documentation.
- **Label** (650, `0.8125rem`, 1.35): metadata, traces, code-adjacent labels; no decorative all-caps section grammar.

### Named Rules
**The Trace Is Type Rule.** Agent traces and warning codes use mono because they are machine artifacts, not decoration.

**The No-Magic Copy Rule.** CTA text names the actual path: use with an agent, try editor, install locally, verify, render, copy source.

## Elevation

The system is flat by default. Depth comes from tonal layering, hairline borders, sticky bars, and code surfaces. Shadows are minimal and structural; wide “ghost card” shadows are prohibited.

### Shadow Vocabulary
- **Hairline** (`0 1px 0 color-mix(in srgb, var(--fg) 5%, transparent)`): subtle separation for static surfaces.
- **Popover** (`0 18px 44px rgba(0,0,0,0.28)` in editor popovers): only for overlays that must rise above the workbench.

### Named Rules
**The Artifact First Rule.** Rendered diagrams and source blocks are the visual evidence. Panels frame artifacts; they do not become the brand.

## Components

### Buttons
- **Shape:** compact rectangle with gentle corners (8px).
- **Primary:** terracotta fill, Paper text, min-height 40px; on mobile/coarse contexts use 44px where practical.
- **Secondary:** surface fill, ink/soft-ink text, hairline border.
- **Hover / Focus:** subtle color shift and 2px accent focus ring; no bounce, glow, or glass.

### Chips / Badges
- **Style:** tier/severity badges use semantic class names and muted tonal fills.
- **State:** color must be paired with text (`structural`, `geometric`, `lint`, `error`, `warning`), never color alone.

### Cards / Containers
- **Corner Style:** 12px for proof panels and grouped cards.
- **Background:** derived surface token on Paper.
- **Shadow Strategy:** hairline only unless the component is an overlay.
- **Internal Padding:** 16px default; denser for tables and code blocks.

### Inputs / Fields
- **Style:** surface fill, hairline border, 8px radius, visible label.
- **Focus:** 2px terracotta focus outline, offset outside the control.
- **Error / Disabled:** status colors must clear WCAG AA when used as text.

### Navigation
- **Style:** quiet document masthead with text links and one editor affordance.
- **Mobile:** wrap rather than hide core routes; preserve current page state.

### Signature Component: Agent Prompt Card
The prompt card is the agent handoff primitive. It must keep copy controls visible, collapse long prompt text behind native disclosure, and preserve the exact chat/Code Mode return contracts.

## Do's and Don'ts

### Do:
- **Do** lead with the honest action order when appropriate: Use with an agent, Try editor, Install locally.
- **Do** show real Mermaid source, rendered output, warnings, and traces as the proof layer.
- **Do** keep local-first boundaries visible near MCP and Code Mode language.
- **Do** use the existing tokens in `website/source/assets/styles.css` and editor CSS before adding new primitives.
- **Do** preserve keyboard focus, live status regions, reduced-motion behavior, and responsive code/table wrapping.

### Don't:
- **Don't** make the site look like a generic SaaS landing page with card grids, glass panels, glowing AI gradients, loud hero metrics, or overbearing CTAs.
- **Don't** imply hosted Code Mode, arbitrary execution, or a production render API.
- **Don't** use gradient text, decorative grid backgrounds, broad soft card shadows, or side-stripe borders.
- **Don't** repeat tiny uppercase/mono section labels as page scaffolding when headings or grouping can do the work.
- **Don't** hide core editor controls on mobile; adapt them so Source, Preview, Diagram, Unicode, ASCII, zoom, pan, copy, export, settings, examples, and theme remain reachable.

## Motion Rules

- Start any animation from the current presentation value; a fresh gesture cancels and takes control immediately.
- Momentum belongs only to a gesture that supplied velocity. Click-triggered controls, menus, dialogs, tabs, and copy feedback never bounce or overshoot.
- Rendering is a response path, never a choreography path: improve render latency and suppress spinner flashes rather than crossfading a preview swap.
- Reduced motion preserves short opacity and colour feedback only. It never restores translation, scale, springs, or decorative movement.
- Do not add translucent chrome. Existing frosted overlays must provide opaque reduced-transparency and increased-contrast fallbacks.
- Keep rubber-band splitters, floating translucent preview toolbars, haptic copy ticks, global page transitions, and broad mechanical px-to-rem conversion out of this product surface unless separately justified and reviewed.
