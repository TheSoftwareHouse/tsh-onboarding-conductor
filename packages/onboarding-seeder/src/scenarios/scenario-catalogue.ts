import { createFaker } from '../data/create-faker';
import { generateApplicant, type Applicant, type RiskArchetype } from '../data/applicant';
import {
  IDENTITY_PROVIDER_KEY,
  OTP_MAX_ATTEMPTS,
  REJECTION_REASONS,
  STEPS,
} from '../workflow/analyst-investigation';
import {
  RISK_REJECT_THRESHOLD,
  assessRisk,
  describeRisk,
  type RiskAssessment,
} from '../workflow/risk-assessment';
import type {
  ExpectedOutcome,
  IdentityVerdict,
  Journey,
  JourneyStage,
  ReviewDecision,
  ScenarioPlan,
} from './scenario-plan';

const RISK_FREE: RiskArchetype = {
  highRiskCountry: false,
  pepSelfDeclared: false,
  riskySourceOfFunds: false,
};
const PEP = { ...RISK_FREE, pepSelfDeclared: true };
const RISKY_FUNDS = { ...RISK_FREE, riskySourceOfFunds: true };
const HIGH_RISK_COUNTRY = { ...RISK_FREE, highRiskCountry: true };
const PEP_AND_FUNDS = { ...PEP, riskySourceOfFunds: true };
const COUNTRY_AND_PEP = { ...HIGH_RISK_COUNTRY, pepSelfDeclared: true };
const COUNTRY_AND_FUNDS = { ...HIGH_RISK_COUNTRY, riskySourceOfFunds: true };
const ALL_RULES = { ...COUNTRY_AND_PEP, riskySourceOfFunds: true };

/** Archetypes that stay below the rejection threshold, with a spread of scores from 0 to 50. */
const ACCEPTED_MIX = [RISK_FREE, RISK_FREE, PEP, RISKY_FUNDS, HIGH_RISK_COUNTRY, PEP_AND_FUNDS];
const MOSTLY_RISK_FREE = [RISK_FREE, RISK_FREE, PEP, RISKY_FUNDS];

/** What a scenario's expectation is derived from. */
interface ScenarioContext {
  key: string;
  applicant: Applicant;
  risk: RiskAssessment;
  journey: Journey;
  /** The other onboarding of a pair that shares an email address. */
  partnerKey?: string;
}

interface FamilySpec {
  family: string;
  count: number;
  /** Cycled across the family's scenarios. */
  archetypes: readonly RiskArchetype[];
  /** Cycled across the family's scenarios. */
  journeys: readonly Journey[];
  /** Consecutive pairs of scenarios share one email address. */
  sharesEmail?: boolean;
  expect: (context: ScenarioContext) => ExpectedOutcome;
}

const KEY_ORDINAL_DIGITS = 2;

const advanceTo = (stage: JourneyStage): Journey => ({ kind: 'advance', stage });
const identityVerdict = (
  verdict: IdentityVerdict,
  extra: { deferred?: boolean; review?: ReviewDecision } = {},
): Journey => ({
  kind: 'identity-verdict',
  verdict,
  deferred: extra.deferred ?? false,
  review: extra.review,
});

const belowThreshold = (risk: RiskAssessment): string =>
  `${describeRisk(risk)}, below the ${RISK_REJECT_THRESHOLD} threshold at ${STEPS.collectProfile}`;

function describeAbandonment(
  step: string,
  reached: string,
): (context: ScenarioContext) => ExpectedOutcome {
  return ({ risk }) => ({
    status: 'awaiting_user',
    step,
    parked: false,
    explanation: `abandoned at ${step}: ${reached}; the applicant never submitted it; ${belowThreshold(risk)}`,
  });
}

function createFamilySpecs(approvedCount: number): FamilySpec[] {
  return [
    {
      family: 'approved',
      count: approvedCount,
      archetypes: ACCEPTED_MIX,
      journeys: [identityVerdict('approve')],
      expect: ({ risk }) => ({
        status: 'approved',
        step: null,
        parked: false,
        explanation: `approved at ${STEPS.checkIdentity}: provider callback accepted with providerVerdict approve; ${belowThreshold(risk)}`,
      }),
    },
    {
      family: 'score-reject',
      count: 4,
      archetypes: [COUNTRY_AND_PEP, COUNTRY_AND_FUNDS, ALL_RULES, COUNTRY_AND_PEP],
      journeys: [advanceTo('profile_submitted')],
      expect: ({ risk }) => ({
        status: 'rejected',
        step: null,
        parked: false,
        explanation: `rejected at ${STEPS.collectProfile}: risk ${risk.score} ≥ ${RISK_REJECT_THRESHOLD} (${risk.factors.join(', ')})`,
      }),
    },
    {
      family: 'verdict-reject',
      count: 3,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [identityVerdict('reject')],
      expect: ({ risk }) => ({
        status: 'rejected',
        step: null,
        parked: false,
        explanation: `rejected at ${STEPS.checkIdentity}: provider callback status rejected, rejectionReason ${REJECTION_REASONS.connectorRejected}; ${belowThreshold(risk)}`,
      }),
    },
    {
      family: 'review-waiting',
      count: 4,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [identityVerdict('review')],
      expect: ({ risk }) => ({
        status: 'awaiting_manual_review',
        step: STEPS.reviewIdentity,
        parked: false,
        explanation: `awaiting manual review at ${STEPS.reviewIdentity}: provider callback accepted with providerVerdict review, no reviewer decision yet; ${belowThreshold(risk)}`,
      }),
    },
    {
      family: 'review-approved',
      count: 2,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [identityVerdict('review', { review: 'approve' })],
      expect: ({ risk }) => ({
        status: 'approved',
        step: null,
        parked: false,
        explanation: `approved at ${STEPS.reviewIdentity}: reviewer decision approve after providerVerdict review; ${belowThreshold(risk)}`,
      }),
    },
    {
      family: 'review-rejected',
      count: 2,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [identityVerdict('review', { review: 'reject' })],
      expect: ({ risk }) => ({
        status: 'rejected',
        step: null,
        parked: false,
        explanation: `rejected at ${STEPS.reviewIdentity}: reviewer decision reject after providerVerdict review, no connector rejection reason; ${belowThreshold(risk)}`,
      }),
    },
    {
      family: 'review-invalid',
      count: 2,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [identityVerdict('review', { review: 'invalid' })],
      expect: ({ risk }) => ({
        status: 'invalid',
        step: null,
        parked: false,
        explanation: `invalid at ${STEPS.reviewIdentity}: reviewer decision invalid after providerVerdict review; ${belowThreshold(risk)}`,
      }),
    },
    {
      family: 'parked-awaiting',
      count: 4,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [advanceTo('identity_parked')],
      expect: ({ risk }) => ({
        status: 'awaiting_user',
        step: STEPS.checkIdentity,
        parked: true,
        explanation: `waiting at ${STEPS.checkIdentity}: parked on ${IDENTITY_PROVIDER_KEY} since the identity check was submitted, no provider callback received; ${belowThreshold(risk)}`,
      }),
    },
    {
      family: 'parked-completed',
      count: 2,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [
        identityVerdict('approve', { deferred: true }),
        identityVerdict('reject', { deferred: true }),
      ],
      expect: ({ risk, journey }) => {
        const approved = journey.kind === 'identity-verdict' && journey.verdict === 'approve';

        return {
          status: approved ? 'approved' : 'rejected',
          step: null,
          parked: false,
          explanation: approved
            ? `approved at ${STEPS.checkIdentity}: parked on ${IDENTITY_PROVIDER_KEY}, then the provider callback accepted with providerVerdict approve; ${belowThreshold(risk)}`
            : `rejected at ${STEPS.checkIdentity}: parked on ${IDENTITY_PROVIDER_KEY}, then the provider callback rejected it, rejectionReason ${REJECTION_REASONS.connectorRejected}; ${belowThreshold(risk)}`,
        };
      },
    },
    {
      family: 'otp-exhausted',
      count: 2,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [{ kind: 'otp-exhausted' }],
      expect: ({ risk }) => ({
        status: 'rejected',
        step: null,
        parked: false,
        explanation: `rejected at ${STEPS.verifyEmailCode}: ${OTP_MAX_ATTEMPTS} wrong verification codes, rejectionReason ${REJECTION_REASONS.attemptsExhausted}; ${belowThreshold(risk)}`,
      }),
    },
    {
      family: `abandoned-${STEPS.collectProfile}`,
      count: 3,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [advanceTo('started')],
      expect: describeAbandonment(STEPS.collectProfile, 'the onboarding was started'),
    },
    {
      family: `abandoned-${STEPS.sendEmailCode}`,
      count: 2,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [advanceTo('profile_submitted')],
      expect: describeAbandonment(STEPS.sendEmailCode, 'the profile was submitted'),
    },
    {
      family: `abandoned-${STEPS.verifyEmailCode}`,
      count: 2,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [advanceTo('email_code_sent')],
      expect: describeAbandonment(STEPS.verifyEmailCode, 'the email code was sent'),
    },
    {
      family: `abandoned-${STEPS.uploadIdentityDocument}`,
      count: 2,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [advanceTo('email_verified')],
      expect: describeAbandonment(STEPS.uploadIdentityDocument, 'the email code was verified'),
    },
    {
      family: `abandoned-${STEPS.checkIdentity}`,
      count: 2,
      archetypes: MOSTLY_RISK_FREE,
      journeys: [advanceTo('document_submitted')],
      expect: describeAbandonment(
        STEPS.checkIdentity,
        'the document was submitted, so the identity check never ran and nothing is parked',
      ),
    },
    {
      family: 'duplicate-applicant',
      count: 2,
      archetypes: [RISK_FREE],
      journeys: [advanceTo('profile_submitted')],
      sharesEmail: true,
      expect: ({ risk, partnerKey }) => ({
        status: 'awaiting_user',
        step: STEPS.sendEmailCode,
        parked: false,
        explanation: `duplicate applicant at ${STEPS.sendEmailCode}: shares one email address with ${partnerKey}, so both profiles carry the same email; ${belowThreshold(risk)}`,
      }),
    },
  ];
}

/**
 * The scenarios of a run, in the order they are keyed and written to the manifest. The same
 * `seed` and `approvedCount` always give the same applicants and the same plan.
 */
export function buildScenarioPlan(seed: number, approvedCount: number): ScenarioPlan[] {
  const faker = createFaker(seed);

  const plans: ScenarioPlan[] = [];
  let ordinal = 0;

  for (const spec of createFamilySpecs(approvedCount)) {
    for (let index = 0; index < spec.count; index++) {
      ordinal++;

      const key = `${spec.family}-${String(index + 1).padStart(KEY_ORDINAL_DIGITS, '0')}`;
      const archetype = spec.archetypes[index % spec.archetypes.length];
      const journey = spec.journeys[index % spec.journeys.length];
      const generated = generateApplicant(faker, archetype, ordinal);
      const partner = spec.sharesEmail && index % 2 === 1 ? plans[plans.length - 1] : undefined;
      const applicant = partner ? { ...generated, email: partner.applicant.email } : generated;
      const risk = assessRisk(applicant);
      const partnerIndex = index % 2 === 0 ? index + 1 : index - 1;
      const partnerKey = spec.sharesEmail
        ? `${spec.family}-${String(partnerIndex + 1).padStart(KEY_ORDINAL_DIGITS, '0')}`
        : undefined;

      plans.push({
        key,
        family: spec.family,
        applicant,
        journey,
        expected: spec.expect({ key, applicant, risk, journey, partnerKey }),
      });
    }
  }

  return plans;
}
