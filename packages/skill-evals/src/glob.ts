import { resolve } from 'node:path';

type ValidateSkillsModule = {
  expandBraces(glob: string): string[];
  globToRegExp(glob: string): RegExp;
};

// The same glob dialect the rules under `.claude/rules/` are matched with: `**` crosses
// directories, `*` stays inside one, `{a,b}` alternates. Requiring the validator runs nothing.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const validateSkills = require(
  resolve(__dirname, '..', '..', '..', 'scripts', 'validate-skills.cjs'),
) as ValidateSkillsModule;

/** Whether a repository-relative path matches a glob. */
export function matchesGlob(path: string, glob: string): boolean {
  return validateSkills
    .expandBraces(glob)
    .some((pattern) => validateSkills.globToRegExp(pattern).test(path));
}
