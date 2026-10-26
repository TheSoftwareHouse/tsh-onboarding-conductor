# Fonts

Empty on purpose. The site loads Inter Tight and JetBrains Mono (both SIL Open Font License) from
Google Fonts in `src/css/custom.css`; nothing here is needed for a build.

## Switching to TWK Everett

TWK Everett is a commercial typeface from Weltkern and is not redistributable, so its files cannot
live in this repository. The stylesheet already names `'TWK Everett'` first and declares it with
`local()` sources, so a reader who has the font installed sees it without any change here.

To have the site itself serve Everett, under a licence that covers webfonts:

1. Put the files here, named exactly:
   - `everett-light.woff2` (300), optionally `everett-light.woff`
   - `everett-regular.woff2` (400), optionally `everett-regular.woff`
2. Uncomment `@import './everett.css';` in `src/css/custom.css`.

Only Light and Regular are used; the stylesheet maps bold to 400 on purpose, so never add another
weight. `.woff` and `.woff2` files in this folder are git-ignored, so a local copy stays local.
