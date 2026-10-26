# Personal Website — Kelvin Chandra Djayapranata

Static academic portfolio site for **Kelvin Chandra Djayapranata** — undergraduate student at
Northwestern Polytechnical University (NPU/NWPU), Xi'an, China — covering AI for Biotechnology
(AI4Bio), computational biology, and protein structure analysis.

Built as plain HTML, CSS, and a few small self-hosted JavaScript files for GitHub Pages. **No
frameworks, no build step, no external fonts, and no third-party requests.**

---

## Status

**Live.** The site is static HTML and CSS published through GitHub Pages, served from the root of
the `main` branch. No build step or workflow runs on deploy — GitHub Pages serves exactly what is
committed, and `.nojekyll` keeps it that way.

| | |
|---|---|
| **Website** | https://kelvinchandradjayapranata-hue.github.io/ |
| **Repository** | https://github.com/kelvinchandradjayapranata-hue/kelvinchandradjayapranata-hue.github.io |

Pages configuration: branch `main`, folder `/`, HTTPS enforced.

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
│   ├── js/hero-voxel-forest.js  Optional homepage WebGL voxel forest
│   ├── js/wall-clocks.js        Homepage wall clocks for Xi'an and WIB
│   ├── js/site-guide.js         Homepage fixed-answer guide (no network calls)
│   └── img/
│       ├── favicon.svg SVG favicon
│       └── profile.jpg Portrait in the home hero (560 px, metadata stripped)
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
- **JavaScript is optional.** Navigation wraps responsively instead of using a hamburger menu, so
  all pages work with scripting disabled. The homepage hero adds a small, self-hosted WebGL scene
  when available and falls back to a CSS gradient otherwise. The homepage also shows two small
  live wall clocks (Xi'an and WIB) at the top-right outside the hero frame — in the outer right
  margin on wide screens, just above the hero on narrower ones — each with a digital readout;
  without scripting the hands rest at 10:10.
- **Hero message.** A thin "Miss u mom" strip runs along the inside bottom edge of the hero;
  hovering or focusing it pauses the motion, and `prefers-reduced-motion` shows a static centred
  line. CSS only — no new script or request.
- **Site guide.** A 56 px launcher in the bottom-right corner opens a fixed-answer guide. Every
  reply is a static string written from these public pages and matched in the browser — no API, no
  network request, no storage. The launcher starts hidden and is revealed only when
  `site-guide.js` runs; the panel opens on demand. Without scripting, no launcher appears.
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
- Keeps every site-guide reply traceable to a public page; no reply may invent a credential,
  result, or contact route.

If you change content, keep to that policy: prefer a smaller true claim over a larger flattering one.

## Publishing updates

Edit the files in this folder, preview them locally, then commit and push. GitHub Pages rebuilds
automatically from `main` — changes normally appear within a minute or two. There is no build step
and nothing to compile.

```bash
cd "D:\project\github.io website"

# 1. Preview locally before publishing
python -m http.server 8000        # then open http://localhost:8000

# 2. Check what will be published
git status --short
git ls-files "*claude*"           # must print nothing

# 3. Publish
git add -A
git commit -m "Update <what changed>"
git push
```

`.gitignore` excludes `.claude/`, which holds machine-local tooling settings and must never be
committed, and `image/`, which holds the full-resolution source photos. Only the web-sized
derivative in `assets/img/` is published.

To confirm a deploy finished, check the Pages build status:

```bash
gh api repos/kelvinchandradjayapranata-hue/kelvinchandradjayapranata-hue.github.io/pages --jq .status
```
