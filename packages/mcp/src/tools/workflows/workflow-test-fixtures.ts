import type { CompiledWorkflow } from './workflow-version-reader';

type Step = CompiledWorkflow['steps'][number];

const SCORE_REJECT_THRESHOLD = 60;
const COUNTRY_RISK_POINTS = 40;

/** A small compiled workflow with a score rule, a threshold transition and a connector. */
export function buildCompiledWorkflow(version: number): CompiledWorkflow {
  const collect: Step = {
    name: 'collect_profile',
    status: 'awaiting_user',
    data: {
      email: { type: 'text', required: true, validation: { format: 'email' } },
      country: { type: 'text', required: true, validation: { oneOf: ['PL', 'RU'] } },
      firstName: { type: 'text', required: true },
    },
    scoring: [{ score: 'risk', when: { field: 'country', in: ['RU'] }, add: COUNTRY_RISK_POINTS }],
    transitions: [
      {
        status: 'success',
        target: 'rejected',
        when: { score: 'risk', gte: SCORE_REJECT_THRESHOLD },
      },
      { status: 'success', target: 'check_identity' },
    ],
  };
  const check: Step = {
    name: 'check_identity',
    status: 'awaiting_user',
    data: {},
    connectors: [
      { name: 'kyc', id: 'mock_kyc_1', type: 'kyc', order: 1, fieldMapping: { email: 'email' } },
    ],
    transitions: [{ status: 'success', target: 'approved' }],
  };
  const approved: Step = { name: 'approved', status: 'approved', data: {}, transitions: [] };
  const rejected: Step = { name: 'rejected', status: 'rejected', data: {}, transitions: [] };

  return {
    id: 'analyst-investigation',
    version,
    name: 'Analyst investigation',
    initial: 'collect_profile',
    scoring: { risk: { min: 0, max: 100 } },
    steps: [collect, check, approved, rejected],
  };
}
