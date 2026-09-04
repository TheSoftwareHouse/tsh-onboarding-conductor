import type { NormalizedWorkflowScore, NormalizedWorkflowScoringRule } from '@tsh/ddl-schema';
import { Scoring } from './scoring';

describe('Scoring', () => {
  const declarations: Readonly<Record<string, NormalizedWorkflowScore>> = {
    risk: { name: 'risk', min: 0, max: 100 },
    trust: { name: 'trust', min: 20, max: 80 },
  };

  describe('initialize', () => {
    it('starts every declared score at its min', () => {
      expect(new Scoring(declarations).initialize()).toEqual({ risk: 0, trust: 20 });
    });

    it('returns {} for a workflow declaring no scoring', () => {
      expect(new Scoring({}).initialize()).toEqual({});
    });
  });

  describe('applyRules', () => {
    it('sums every rule whose when holds, including an unconditional rule', () => {
      const scoring = new Scoring(declarations);
      const rules: NormalizedWorkflowScoringRule[] = [
        { score: 'risk', when: { field: 'country', in: ['RU', 'IR'] }, add: 40 },
        { score: 'risk', when: { field: 'country', equals: 'PL' }, add: -10 },
        { score: 'risk', when: { field: 'highRiskChannel', equals: true }, add: 20 },
        { score: 'risk', add: 5 },
      ];

      const next = scoring.applyRules({ risk: 0 }, rules, { country: 'RU', highRiskChannel: true });

      // matching RU rule (+40), non-matching PL rule (skipped), matching channel rule (+20), and
      // the unconditional rule (+5, always contributes) sum to 65.
      expect(next).toEqual({ risk: 65 });
    });

    it('clamps each touched score once after the full sum, not after each add', () => {
      const scoring = new Scoring(declarations);
      const rules: NormalizedWorkflowScoringRule[] = [
        { score: 'risk', add: -20 },
        { score: 'risk', add: 50 },
      ];

      // Clamped after every add: max(0, 0 - 20) = 0, then 0 + 50 = 50.
      // Clamped once after the sum: 0 - 20 + 50 = 30, within [0, 100] already.
      expect(scoring.applyRules({ risk: 0 }, rules, {})).toEqual({ risk: 30 });
    });

    it('clamps to max when the sum overshoots the upper bound', () => {
      const scoring = new Scoring(declarations);
      const rules: NormalizedWorkflowScoringRule[] = [
        { score: 'risk', add: 80 },
        { score: 'risk', add: 80 },
      ];

      expect(scoring.applyRules({ risk: 0 }, rules, {})).toEqual({ risk: 100 });
    });

    it('clamps to min when the sum undershoots the lower bound', () => {
      const scoring = new Scoring(declarations);
      const rules: NormalizedWorkflowScoringRule[] = [
        { score: 'risk', when: { field: 'country', equals: 'PL' }, add: -10 },
        { score: 'risk', add: 5 },
      ];

      // -10 + 5 = -5, clamped once to the declared min of 0.
      expect(scoring.applyRules({ risk: 0 }, rules, { country: 'PL' })).toEqual({ risk: 0 });
    });

    it('enters a score absent from current at its declared min before summing', () => {
      const scoring = new Scoring(declarations);
      const rules: NormalizedWorkflowScoringRule[] = [{ score: 'trust', add: 5 }];

      expect(scoring.applyRules({}, rules, {})).toEqual({ trust: 25 });
    });

    it('leaves scores untouched by any rule unchanged', () => {
      const scoring = new Scoring(declarations);
      const rules: NormalizedWorkflowScoringRule[] = [{ score: 'risk', add: 10 }];

      expect(scoring.applyRules({ risk: 0, trust: 40 }, rules, {})).toEqual({
        risk: 10,
        trust: 40,
      });
    });

    it('does not mutate current', () => {
      const scoring = new Scoring(declarations);
      const current = { risk: 0 };
      const rules: NormalizedWorkflowScoringRule[] = [{ score: 'risk', add: 10 }];

      scoring.applyRules(current, rules, {});

      expect(current).toEqual({ risk: 0 });
    });

    it('produces the same result regardless of declaration order, even across a clamp', () => {
      const scoring = new Scoring(declarations);
      const forwardRules: NormalizedWorkflowScoringRule[] = [
        { score: 'risk', add: -20 },
        { score: 'risk', add: 50 },
      ];
      const reversedRules: NormalizedWorkflowScoringRule[] = [...forwardRules].reverse();

      const forward = scoring.applyRules({ risk: 0 }, forwardRules, {});
      const reversed = scoring.applyRules({ risk: 0 }, reversedRules, {});

      expect(forward).toEqual(reversed);
      expect(forward).toEqual({ risk: 30 });
    });
  });
});
