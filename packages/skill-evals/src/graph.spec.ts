import { type CompilationReport, diffSignatures, graphSignature } from './graph';

const report = (names: { start: string; review: string }): CompilationReport => ({
  definition: {
    initial: names.start,
    steps: [
      { name: names.start, status: 'awaiting_user' },
      { name: names.review, status: 'awaiting_manual_review' },
      { name: 'approved', status: 'approved' },
      { name: 'rejected', status: 'rejected' },
    ],
  },
  steps: [
    {
      name: names.start,
      type: 'form',
      compiledStepNames: [names.start],
      ports: [{ name: 'success', arms: [{ target: names.review }] }],
    },
    {
      name: names.review,
      type: 'manual-review',
      compiledStepNames: [names.review],
      ports: [
        { name: 'approve', arms: [{ target: 'approved', when: { field: 'x', equals: 1 } }] },
        { name: 'reject', arms: [{ target: 'rejected' }] },
        { name: 'invalid', arms: [] },
      ],
    },
    { name: 'approved', type: 'terminal', compiledStepNames: ['approved'], ports: [] },
    { name: 'rejected', type: 'terminal', compiledStepNames: ['rejected'], ports: [] },
  ],
});

describe('graphSignature', () => {
  it('describes types, ports, conditionality, terminal outcomes and the initial step without names', () => {
    expect(graphSignature(report({ start: 'collect', review: 'review' }))).toEqual(
      [
        'initial: form',
        'node: form',
        'node: manual-review',
        'node: terminal[approved]',
        'node: terminal[rejected]',
        'form.success -> manual-review',
        'manual-review.approve? -> terminal[approved]',
        'manual-review.reject -> terminal[rejected]',
      ].sort(),
    );
  });

  it('is unchanged by renaming steps', () => {
    expect(graphSignature(report({ start: 'a', review: 'b' }))).toEqual(
      graphSignature(report({ start: 'collect_email', review: 'human_check' })),
    );
  });
});

describe('diffSignatures', () => {
  it('reports what the golden has that the actual lacks, and the reverse, as multisets', () => {
    expect(diffSignatures(['a', 'a', 'b'], ['a', 'c'])).toEqual({
      missing: ['a', 'b'],
      extra: ['c'],
    });
    expect(diffSignatures(['a'], ['a'])).toEqual({ missing: [], extra: [] });
  });
});
