# Personal Website — Kelvin Chandra Djayapranata

Static academic portfolio site for **Kelvin Chandra Djayapranata** — undergraduate student at
Northwestern Polytechnical University (NPU/NWPU), Xi'an, China — covering AI for Biotechnology
(AI4Bio), computational biology, and protein structure analysis.

Built as plain HTML and CSS for GitHub Pages. **No frameworks, no build step, no JavaScript, no
external fonts, and no third-party requests.**

---

## Status

**Local only — not deployed.** This repository has not been initialised as a Git repository, and no
GitHub repository or GitHub Pages site exists for it. Deployment requires separate authorisation.

## Structure

```text
.
├── index.html          Home — profile summary, current work, navigation
├── about.html          Academic background, focus, working approach
├── projects.html       ai-biotech — status, pipeline stages, limitations
├── research.html       Research interests and directions
├── writing.html        Technical writing — Biopython guide
├── contact.html        GitHub and LinkedIn
├── 404.html            Not-found page
├── assets/
│   ├── css/style.css   Single stylesheet (design tokens, light + dark)
│   └── img/favicon.svg SVG favicon
├── .gitignore          Excludes local tooling config
├── .nojekyll           Prevents Jekyll processing on GitHub Pages
└── README.md           This file
```

## Local preview

Open `index.html` directly in a browser, or serve the folder over HTTP:

```bash
# Python 3
python -m http.server 8000

# then visit http://localhost:8000
```

All links between pages are relative (`about.html`, `assets/css/style.css`), so the site works from
any directory, subpath, or host without modification.

## Design notes

- **One stylesheet.** `assets/css/style.css` holds all design tokens and components.
- **No JavaScript.** Navigation wraps responsively instead of using a hamburger menu, so it works
  even with scripting disabled.
- **Dark mode** follows the operating system via `prefers-color-scheme` — no toggle, no storage.
- **Accessibility.** Skip link, semantic landmarks, `aria-current` on the active nav item, visible
  focus outlines, and text contrast checked in both themes.
- **System fonts only**, so there are no web-font downloads and no layout shift.

## Content policy

Every factual claim on this site is drawn from the owner's public GitHub profile and public
repositories. The site deliberately:

- Links only the two verified public repositories (`ai-biotech` and `why-biopython-matters`).
- Does **not** publish a personal email address or any sensitive contact detail.
- Does **not** claim publications, awards, research positions, or completed results.
- States explicitly what is unfinished — including that no model has been trained and no
  experimental validation exists.

If you change content, keep to that policy: prefer a smaller true claim over a larger flattering one.

## Deployment (not yet authorised)

For a user site at `https://<username>.github.io`, the GitHub repository must be named exactly
`kelvinchandradjayapranata-hue.github.io`, with Pages served from the default branch root.
`.nojekyll` is already in place.

No `git init`, remote creation, push, or Pages configuration has been performed.
