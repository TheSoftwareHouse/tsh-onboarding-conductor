import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDdl } from './checks';
import { loadGoldenSets } from './golden-set';
import { validateGoldenArtifacts } from './main';
import { REPO_ROOT } from './runner';

/**
 * The golden sets checked into `.claude/skills/*\/evals/` are data nothing else type-checks. This is
 * what `pnpm skills:evals --validate` does, run where CI runs everything: every set parses, every
 * golden workflow compiles, and every input meant to be broken is.
 */
describe('the checked-in golden sets', () => {
  const loaded = loadGoldenSets(REPO_ROOT);
  const ddl = loadDdl();

  it('parse without a problem and cover every skill', () => {
    expect(loaded.problems).toEqual([]);
    expect(loaded.skillsWithoutEvals).toEqual([]);
    expect(loaded.sets.map((set) => set.skill)).toEqual([
      'creating-engine-bffs',
      'creating-workflows',
    ]);
  });

  it('carry golden workflows the engine would load', () => {
    expect(validateGoldenArtifacts(loaded.sets, ddl)).toEqual([]);
  });

  it('carry inputs that fail the way their case says', () => {
    const workflows = loaded.sets.find((set) => set.skill === 'creating-workflows');
    const broken = workflows?.cases.find((entry) => entry.id === 'fix-unwired-port')?.files[0];

    expect(broken).toBeDefined();
    expect(() =>
      ddl.compileWorkflowReport(
        JSON.parse(readFileSync(join(workflows!.directory, broken!.from), 'utf8')),
      ),
    ).toThrow(
      expect.objectContaining({ reason: 'INVALID_TRANSITIONS', path: 'steps[3].edges.reject' }),
    );
  });
});
