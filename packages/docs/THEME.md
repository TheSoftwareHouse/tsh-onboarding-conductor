# Theme spec — Onboarding Conductor docs (TSH)

Everything below is implemented in `src/css/custom.css`; this file explains the intent so deviations
can be judged. Values come from the TSH design system (Widelabs Figma). Mockups: `../Conductor Docs Theme.dc.html`.

## 1. Tokens → Infima

| Role                   | Light                               | Dark                             | Infima var                                                                 |
| ---------------------- | ----------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| Page                   | `#FFFFFF`                           | `#1D1F20`                        | `--ifm-background-color`                                                   |
| Surface (code, drawer) | `#F7F9FA` pre / `#EDF1F4` inline    | `#282A2B` pre / `#313435` inline | `--ifm-pre-background`, `--ifm-code-background`                            |
| Ink / headings / links | `#000000`                           | `#FFFFFF`                        | `--ifm-heading-color`, `--ifm-link-color`, `--ifm-color-primary`           |
| Body text              | `#444849`                           | `#CFD8DD`                        | `--ifm-font-color-base`                                                    |
| Secondary text         | `#62686A`                           | `#BFC3C4`                        | `--ifm-font-color-secondary`                                               |
| Meta / eyebrow         | `#8F9094`                           | `#8F9094`                        | `--tsh-gray-500`                                                           |
| Hairline               | `rgba(0,0,0,.10)`                   | `rgba(255,255,255,.12)`          | `--tsh-border-hair`                                                        |
| Rule                   | `rgba(0,0,0,.12)`                   | `rgba(255,255,255,.12)`          | `--tsh-border-rule`, `--ifm-toc-border-color`, `--ifm-hr-background-color` |
| Strong border (inputs) | `rgba(0,0,0,.15)`                   | `rgba(255,255,255,.20)`          | `--tsh-border-strong`                                                      |
| Note / info admonition | rule `#000`, fill white             | rule `#fff`, no fill             | `--ifm-color-info*`                                                        |
| Tip admonition         | rule `#5CC0FF`, fill `#D1E8FF`      | rule `#8DD4FF`, no fill          | `--ifm-color-success*`                                                     |
| Warning admonition     | rule `#FFB84A`, fill `#FEE8C8`      | rule `#FFC269`, no fill          | `--ifm-color-warning*`                                                     |
| Danger admonition      | rule `#EE1313`, fill white          | same                             | `--ifm-color-danger*`                                                      |
| Highlighted code line  | `#FEE8C8`                           | `rgba(255,194,105,.18)`          | `--docusaurus-highlighted-code-line-bg`                                    |
| Radius                 | `0`                                 | `0`                              | every `--ifm-*-border-radius`                                              |
| Shadow                 | `none`                              | `none`                           | `--ifm-global-shadow-*`                                                    |
| Easing                 | `cubic-bezier(.4,0,.2,1)` 150–400ms |                                  | `--ifm-transition-*`                                                       |

Syntax colors on dark panels (API right panel, home terminal, fixture JSON): keys `#8DD4FF`, strings `#FFCE85`,
numbers/booleans/null `#B5B4FF`, prompt/comments `#8F9094`, plain `#EDF1F4`. Write these as a custom Prism theme
(`src/prism/tsh-dark.ts`) and a light one on `#F7F9FA` with ink `#1D1F20`, strings `#62686A`… — keep to the palette.

## 2. Type

Family: Inter Tight (300, 400) as shipped; TWK Everett (300, 400) takes over only where a reader has it installed or a licence holder serves it (`static/fonts/README.md`). Mono: JetBrains Mono. UI never bold.

| Element                         | Size / line-height                | Weight            | Tracking           |
| ------------------------------- | --------------------------------- | ----------------- | ------------------ |
| Home H1                         | 80 / 1.0 (mobile 40 / 1.04)       | 400               | −0.04em            |
| Section H1 (fixtures)           | 60 / 1.04                         | 400               | −0.04em            |
| Doc H1                          | 48 / 1.12 (mobile 34 / 1.1)       | 400               | −0.04em            |
| API endpoint H1                 | 36 / 1.2                          | 400               | −0.04em            |
| Doc H2                          | 28 / 1.24                         | 400               | −0.04em            |
| Doc H3 / card title             | 24 / 1.32                         | 300 (cards) / 400 | −0.04em            |
| Lead paragraph                  | 20 / 1.44                         | 300               | 0                  |
| Body                            | 16 / 1.6                          | 400               | 0                  |
| Sidebar, table, admonition body | 14–15 / 1.44–1.55                 | 400               | 0                  |
| TOC                             | 13 / 1.5                          | 400               | 0                  |
| Eyebrow / caps                  | 12 / 1                            | 500               | +0.06em, uppercase |
| Rule numbers (best practices)   | 40 / 1                            | 500               | +0.06em            |
| Code                            | 13 / 1.7 (inline inherits −1–2px) | 400               | 0                  |
| Method badge, sidebar method    | 10–11 mono                        | 500               | +0.04em            |

## 3. Layout

- Navbar 64px (mobile 56), hairline bottom, no shadow. Signet 16×26 + "Onboarding Conductor" 16px + "DOCS" eyebrow behind a hairline divider. Instance tabs left (active = 1px underline in ink). Right: 240px hairline search field with `⌘K`, hairline version box, mode toggle, "GitHub" underlined.
- Docs grid: sidebar 280 · content (max 760 text measure, 64px side padding) · TOC 260. API instance: sidebar 280 · description · 520px sticky dark panel (`#1D1F20`).
- Sidebar: no background, hairline right edge, 32px top padding. Category labels are eyebrows. Active item: 2px ink left rule, ink text; hover `#F7F9FA`. Nested items indent 12px.
- TOC: 1px rule on the left; active heading = 1px ink rule + ink text; "On this page" eyebrow above.
- Content rhythm: breadcrumb eyebrow → H1 → lead → hairline → sections. Prev/next as eyebrow + 15px title above a rule, no boxes.
- Home: hero grid 7/5 with dark terminal block; three hairline-separated entry cards (eyebrow `01 · Guides`, 28px light title, body, arrow link); statement band on the KV gradient at 55% over `#EDF1F4` (48px headline + three `→` lines); footer with wordmark and MIT line.
- Fixtures: 3-column card grid with hairline cells (built-in fixture cell filled `#EDF1F4`), filter chips (32px, hairline; active black), detail page = description + step map + JSON block on dark.
- Search modal: 680px, hairline border, 60px input with 1px ink underline, results grouped by instance eyebrow, active hit `#EDF1F4` + 2px ink rule, matches highlighted `#FEE8C8`.
- Mobile (≤996): hamburger drawer 320px with instance tabs row, 44px+ hit targets, stacked buttons full-width, TOC collapses to "On this page ▾" strip under a hairline.

## 4. Components

- Buttons: 48px, 0 radius, 16px text. Primary black/white (dark: inverted), hover `#1D1F20`. Secondary 1px ink outline, hover fills.
- Chips: 32px hairline; active black. Tags: 24px `#EDF1F4` mono 11px.
- Tables: header row caps eyebrow over a 1px ink rule; rows hairline; no stripes, no outer border.
- Code blocks: hairline box, 11px mono title bar (language · copy icon), no shadow.
- Admonitions: hairline box + 2px left rule; title as eyebrow; icon hidden.
- Method badges: POST black/white · GET `#D1E8FF` · PUT/PATCH `#FEE8C8` · DELETE red outline. Sidebar method prefixes in mono: GET `#2E98E6`, POST ink, PUT/PATCH `#8785FF`, DELETE `#EE1313`.
- Cards (DocCardList): hairline, hover border → ink, title 24/300.

## 5. Swizzle list (`pnpm docusaurus swizzle @docusaurus/theme-classic <name> --eject|--wrap`)

Required for the mockups to match; everything else is CSS-only.

| Component                 | Mode            | Why                                                                                                     |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `Footer`                  | eject           | Wordmark SVG left, links right, single row (mockup 1a). Default footer is column-based.                 |
| `DocSidebarItem/Category` | wrap            | Render level-1 categories as non-collapsible eyebrow labels (CSS handles most; wrap to drop the caret). |
| `TOC` / `TOCItems`        | wrap            | Inject "On this page" eyebrow (CSS `:before` fallback exists).                                          |
| `DocItem/Footer`          | wrap            | Move "Edit this page" + "Last updated" into the TOC column as 13px meta (mockup 1b).                    |
| `Navbar/Content`          | wrap (optional) | Add the "DOCS" eyebrow after the title.                                                                 |
| `ApiItem` (openapi-docs)  | wrap            | Sticky dark right panel, response-code tabs styling; mostly CSS via `.openapi-right-panel__container`.  |
| `SearchBar`               | none            | DocSearch themed via `--docsearch-*`.                                                                   |

Home page (`src/pages/index.tsx`) is custom, not a swizzle: hero + terminal block + 3 entry cards + statement band. Do not use `HomepageFeatures`.

## 6. Do / don't

Do: hairlines for structure · black as the only UI accent · `→` on lead copy · sentence case · numerals.
Don't: rounded corners · shadows · gradient buttons · bold headings · pastel backgrounds on chrome · emoji · Docusaurus green (`#2e8555`) anywhere.
