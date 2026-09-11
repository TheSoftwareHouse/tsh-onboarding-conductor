# Fonts

Empty on purpose. No webfont is installed yet — every stack currently falls through to `system-ui`.
`src/app/fonts.css` is the single place that changes when we enable them, and it lists the exact
commands for each of the three faces.

## Switching to TWK Everett

TWK Everett is a commercial typeface from Weltkern and is not redistributable, so it cannot live in
this repo. Once TSH's license covers webfonts:

1. Put the files here, named exactly:
   - `everett-light.woff2` (300), optionally `everett-light.woff`
   - `everett-regular.woff2` (400), optionally `everett-regular.woff`
   - `everett-medium.woff2` (500), optionally `everett-medium.woff`
2. Add `@import './everett.css';` to `src/app/fonts.css`.

Nothing else changes: `--font-display`, `--font-body` and the legacy stack in `styles.css` already
name `'TWK Everett'` first, so it takes over as soon as it resolves.

Files go here rather than under `src/` because Vite copies `public/` through without checking it —
a `url()` in `src/` pointing at a file that is not there fails the build.

Per the design system's `fonts/NOTES.md` only Light and Regular are licensed, while the brand uses
Medium as well. If Medium is missing, delete that `@font-face` block from `everett.css` and 500
falls through to Inter Tight, which has it. Caps labels and chips are the weight that depends on it.
