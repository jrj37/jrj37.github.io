# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

Personal portfolio site for Jean-Raphaël Julien (data scientist, AI / deep learning), served by GitHub Pages from the root domain https://jrj37.github.io. Content is written in French.

## Stack

- **TypeScript** (strict) with **Vite** as the bundler.
- **Vanilla TS** — no framework. Each interactive piece is a small module under `src/modules/` mounted by `src/main.ts`.
- **Fonts**: Fraunces (variable serif, display + body) and IBM Plex Mono (data / labels), loaded from Google Fonts.
- **Deploy**: `.github/workflows/deploy.yml` builds on every push to `main` and publishes `dist/` via the official GitHub Pages action. No manual deploy step.

## Commands

```bash
npm install        # install deps
npm run dev        # vite dev server (HMR)
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # serve dist/ for a final check
```

`npm run build` runs the TypeScript type-check before bundling, so a passing build means types are clean.

## Architecture

The page is a single HTML document (`index.html`) that pulls in:
1. `/src/style.css` — the design system (CSS variables + section styles, no preprocessor).
2. `/src/main.ts` — the boot function that wires DOM nodes to behavior modules.

The page is a hash-routed single-page app: `index.html` holds five `[data-view]` containers (`about`, `cv`, `projets`, `repos`, `blog`) and `modules/router.ts` toggles the active one from `location.hash`, syncing the floating pill nav.

Each module is a single named export taking the DOM element it owns:
- `modules/router.ts` — hash router; shows the active view, highlights the nav, resolves project anchors (`#bot-trading`, …) to the Projets view.
- `modules/clock.ts` — live `HH:MM:SS` in the status bar, updates every second.
- `modules/counter.ts` — count-up animation for the hero stats, triggered by `IntersectionObserver`.
- `modules/equity-curve.ts` — deterministic synthetic random-walk rendered as an animated SVG path for the bot trading project.
- `modules/cloud.ts` — interactive WebGL galaxy in the hero; each star is a project (click routes to Projets).

To add a new behavior, add a module under `src/modules/`, then mount it from `boot()` in `src/main.ts`.

## Design system

The aesthetic is "quant research terminal" — dark warm-black background, electric lime accent (`--accent: #d6ff37`), subtle grid + grain overlay. Two-font pairing carries the personality (variable serif for editorial weight, mono for data). Design tokens live as CSS custom properties at the top of `src/style.css`; reach for those rather than hard-coded values.

## Conventions

- User-visible copy in **French**.
- The projects section currently shows **only the bot trading project**. Adding more projects later means duplicating the `.project` block pattern in `index.html`.
- Keep the bundle lean — no frameworks, no UI libraries. The whole site is intentionally small (currently ~5 KB gzipped JS + CSS).
