import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GoldenCase, GoldenSet } from './golden-set';
import { resolveManifestReferences } from './main';
import {
  DEFAULT_MANIFEST_PATH,
  MANIFEST_ENV,
  type SeedManifest,
  hasMalformedPlaceholder,
  loadManifest,
  manifestPath,
  readGoldenText,
  referencedKeys,
  resolveCase,
  substitute,
} from './manifest';
import { REPO_ROOT } from './runner';

const manifest: SeedManifest = new Map([
  ['score-reject-03', { onboardingId: 'id-reject-03', explanation: 'rejected at score_gate' }],
  ['approved-01', { onboardingId: 'id-approved-01', explanation: 'approved at check_identity' }],
]);

const baseCase: GoldenCase = {
  id: 'why-rejected',
  prompt: 'Why was onboarding {{manifest:score-reject-03}} rejected?',
  invocation: 'explicit',
  expectedOutput: 'It was {{manifest:score-reject-03.explanation}}.',
  files: [],
  checks: [{ type: 'skill-fired', skill: 'x', expected: true }],
  assertions: [
    { text: 'Says: {{manifest:score-reject-03.explanation}}', severity: 'error' },
    {
      text: 'Names {{manifest:score-reject-03}} and not {{manifest:approved-01}}',
      severity: 'warn',
    },
  ],
  threshold: 70,
  judge: true,
};

describe('placeholders', () => {
  it('lists the scenario keys a text references', () => {
    expect(
      referencedKeys('{{manifest:a-1}} then {{manifest:b_2.explanation}} and {{manifest:a-1}}'),
    ).toEqual(['a-1', 'b_2', 'a-1']);
    expect(referencedKeys('no placeholder, {{other:x}}')).toEqual([]);
  });

  it('flags a placeholder that is not the documented form', () => {
    expect(hasMalformedPlaceholder('{{manifest:a}} {{manifest:b.explanation}}')).toBe(false);
    expect(hasMalformedPlaceholder('plain text')).toBe(false);
    expect(hasMalformedPlaceholder('{{manifest:}}')).toBe(true);
    expect(hasMalformedPlaceholder('{{manifest:a.id}}')).toBe(true);
    expect(hasMalformedPlaceholder('{{manifest:a}')).toBe(true);
    expect(hasMalformedPlaceholder('{{manifest:a b}}')).toBe(true);
  });
});

describe('substitute', () => {
  it('replaces the id and the explanation, every time they appear', () => {
    expect(
      substitute(
        '{{manifest:score-reject-03}} / {{manifest:score-reject-03.explanation}} / {{manifest:score-reject-03}}',
        manifest,
      ),
    ).toEqual({
      text: 'id-reject-03 / rejected at score_gate / id-reject-03',
      missing: [],
    });
  });

  it('leaves a placeholder whose key the manifest lacks and names the key', () => {
    expect(substitute('{{manifest:nope}} {{manifest:approved-01}}', manifest)).toEqual({
      text: '{{manifest:nope}} id-approved-01',
      missing: ['nope'],
    });
  });
});

describe('resolveCase', () => {
  it('replaces placeholders in the prompt, the expected output and every assertion', () => {
    const result = resolveCase(baseCase, manifest);

    expect('testCase' in result && result.testCase).toMatchObject({
      prompt: 'Why was onboarding id-reject-03 rejected?',
      expectedOutput: 'It was rejected at score_gate.',
      assertions: [
        { text: 'Says: rejected at score_gate', severity: 'error' },
        { text: 'Names id-reject-03 and not id-approved-01', severity: 'warn' },
      ],
    });
  });

  it('carries a golden answer with placeholders as already-resolved content', () => {
    const result = resolveCase(baseCase, manifest, 'Answer: {{manifest:approved-01.explanation}}');

    expect('testCase' in result && result.testCase.goldenContent).toBe(
      'Answer: approved at check_identity',
    );

    const without = resolveCase(baseCase, manifest);

    expect('testCase' in without && 'goldenContent' in without.testCase).toBe(false);
  });

  it('reports each missing key once, across every text of the case', () => {
    expect(
      resolveCase(
        {
          ...baseCase,
          prompt: '{{manifest:gone}}',
          expectedOutput: '{{manifest:gone.explanation}}',
        },
        manifest,
        '{{manifest:also-gone}}',
      ),
    ).toEqual({ missing: ['gone', 'also-gone'] });
  });
});

describe('manifestPath', () => {
  it('defaults to the seeder output, and SKILL_EVALS_MANIFEST overrides it', () => {
    expect(manifestPath({})).toBe(join(REPO_ROOT, DEFAULT_MANIFEST_PATH));
    expect(manifestPath({ [MANIFEST_ENV]: '  ' })).toBe(join(REPO_ROOT, DEFAULT_MANIFEST_PATH));
    expect(manifestPath({ [MANIFEST_ENV]: 'tmp/m.json' })).toBe(join(REPO_ROOT, 'tmp', 'm.json'));
    expect(manifestPath({ [MANIFEST_ENV]: '/elsewhere/m.json' })).toBe('/elsewhere/m.json');
  });
});

describe('with a manifest on disk', () => {
  let directory: string;
  let file: string;

  const write = (contents: string) => writeFileSync(file, contents);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'skill-evals-manifest-'));
    file = join(directory, 'manifest.json');
    mkdirSync(join(directory, 'golden'));
  });

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  const set = (): GoldenSet => ({ skill: 'investigating', directory, cases: [] });
  const selection = (testCase: GoldenCase) => [{ set: set(), testCase }];

  it('loads the scenarios by key', () => {
    write(
      JSON.stringify({
        scenarios: [{ key: 'a', onboardingId: 'id-a', explanation: 'because a', parked: false }],
      }),
    );

    expect(loadManifest(file).get('a')).toEqual({ onboardingId: 'id-a', explanation: 'because a' });
  });

  it('says what to run when the manifest is absent', () => {
    expect(() => loadManifest(join(directory, 'missing.json'))).toThrow(
      /does not exist; run `pnpm stack:mcp:up` and `pnpm onboardings:seed`/,
    );
  });

  it('refuses a manifest that is not JSON or has no scenarios', () => {
    write('{ nope');
    expect(() => loadManifest(file)).toThrow(/not JSON/);
    write('{}');
    expect(() => loadManifest(file)).toThrow(/no "scenarios" list/);
    write(JSON.stringify({ scenarios: [{ key: 'a' }] }));
    expect(() => loadManifest(file)).toThrow(/without a string key/);
  });

  it('reads a golden answer only when it holds a placeholder', () => {
    writeFileSync(join(directory, 'golden', 'with.md'), 'id {{manifest:a}}');
    writeFileSync(join(directory, 'golden', 'without.md'), 'plain');

    expect(readGoldenText(directory, { ...baseCase, golden: 'golden/with.md' })).toBe(
      'id {{manifest:a}}',
    );
    expect(readGoldenText(directory, { ...baseCase, golden: 'golden/without.md' })).toBeUndefined();
    expect(readGoldenText(directory, baseCase)).toBeUndefined();
  });

  describe('resolveManifestReferences', () => {
    it('replaces the placeholders of every selected case, golden answer included', () => {
      writeFileSync(join(directory, 'golden', 'answer.md'), '{{manifest:approved-01}}');

      const result = resolveManifestReferences(
        selection({ ...baseCase, golden: 'golden/answer.md' }),
        () => manifest,
      );

      expect(result).toEqual([
        {
          set: set(),
          testCase: expect.objectContaining({
            prompt: 'Why was onboarding id-reject-03 rejected?',
            goldenContent: 'id-approved-01',
          }),
        },
      ]);
    });

    it('needs no manifest for cases without placeholders', () => {
      const plain = { ...baseCase, prompt: 'p', expectedOutput: 'e', assertions: [] };
      const load = jest.fn(() => {
        throw new Error('must not be read');
      });

      expect(resolveManifestReferences(selection(plain), load)).toEqual(selection(plain));
      expect(load).not.toHaveBeenCalled();
    });

    it('fails with the loader message when the manifest is absent', () => {
      expect(
        resolveManifestReferences(selection(baseCase), () =>
          loadManifest(join(directory, 'none.json')),
        ),
      ).toContain('pnpm onboardings:seed');
    });

    it('fails naming the case, the missing key and the keys the manifest has', () => {
      const message = resolveManifestReferences(
        selection({ ...baseCase, prompt: 'Why {{manifest:nope}}?' }),
        () => manifest,
      );

      expect(message).toEqual(expect.any(String));
      expect(message).toContain('investigating/why-rejected');
      expect(message).toContain('nope');
      expect(message).toContain('score-reject-03, approved-01');
      expect(message).toContain('pnpm stack:mcp:up');
    });
  });
});
