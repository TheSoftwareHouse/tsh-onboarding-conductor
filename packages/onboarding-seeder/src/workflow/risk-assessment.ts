import { HIGH_RISK_COUNTRIES, RISKY_SOURCES_OF_FUNDS } from './analyst-investigation';

/** The `risk` score rules of `collect_profile`, and the threshold at which it rejects. */
export const RISK_POINTS = {
  highRiskCountry: 40,
  pepSelfDeclared: 30,
  riskySourceOfFunds: 20,
} as const;
export const RISK_REJECT_THRESHOLD = 60;

export interface RiskInput {
  country: string;
  pepSelfDeclared: boolean;
  sourceOfFunds: string;
}

export interface RiskAssessment {
  score: number;
  /** Each rule that fired, as `country RU +40`. */
  factors: string[];
  rejects: boolean;
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const fired: Array<{ label: string; points: number }> = [];

  if ((HIGH_RISK_COUNTRIES as readonly string[]).includes(input.country)) {
    fired.push({ label: `country ${input.country}`, points: RISK_POINTS.highRiskCountry });
  }
  if (input.pepSelfDeclared) {
    fired.push({ label: 'PEP', points: RISK_POINTS.pepSelfDeclared });
  }
  if ((RISKY_SOURCES_OF_FUNDS as readonly string[]).includes(input.sourceOfFunds)) {
    fired.push({
      label: `source of funds ${input.sourceOfFunds}`,
      points: RISK_POINTS.riskySourceOfFunds,
    });
  }

  const score = fired.reduce((sum, rule) => sum + rule.points, 0);

  return {
    score,
    factors: fired.map((rule) => `${rule.label} +${rule.points}`),
    rejects: score >= RISK_REJECT_THRESHOLD,
  };
}

/** `risk 70 (country RU +40, PEP +30)`, or `risk 0 (no rule fired)`. */
export function describeRisk(assessment: RiskAssessment): string {
  const factors = assessment.factors.length > 0 ? assessment.factors.join(', ') : 'no rule fired';
  return `risk ${assessment.score} (${factors})`;
}
