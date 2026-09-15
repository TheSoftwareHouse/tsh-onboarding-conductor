const { ESLint } = require('eslint');

/**
 * ESLint reports "File ignored ..." as a warning when it is handed a file its own configuration
 * excludes, and this hook runs with `--max-warnings=0` — so one staged file inside generated
 * output (a package `dist`, a Docusaurus `build` or `.docusaurus` cache) would fail the commit
 * over a warning about itself. Ask ESLint which staged files it would actually lint instead of
 * restating its ignore list here, where the two would drift apart.
 */
async function lintableFiles(files) {
  const eslint = new ESLint({});
  const ignored = await Promise.all(files.map((file) => eslint.isPathIgnored(file)));

  return files.filter((file, index) => !ignored[index]);
}

module.exports = {
  '*.{js,cjs,mjs,ts,tsx}': async (files) => {
    const lintable = await lintableFiles(files);

    if (lintable.length === 0) {
      return [];
    }

    // lint-staged runs the returned command without a shell, splitting it the way a shell would,
    // so each path is quoted here rather than interpolated bare.
    const paths = lintable.map((file) => JSON.stringify(file)).join(' ');

    return [`pnpm exec eslint --max-warnings=0 ${paths}`];
  },
  '*.{js,cjs,mjs,ts,tsx,json,md,yml,yaml}': ['pnpm exec prettier --check'],

  // A skill or a rule is prose that nothing else in this pipeline can check: ESLint does not read
  // it and Prettier only reformats it, so a citation that went stale when a file was renamed
  // reaches the model as an instruction. `validate-skills.cjs` takes the staged paths and validates
  // the whole skill each one belongs to — editing a single reference document still checks the
  // SKILL.md that has to cite it.
  '.claude/{skills,rules}/**/*.md': ['node scripts/validate-skills.cjs'],
};
