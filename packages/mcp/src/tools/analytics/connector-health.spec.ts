import type { components } from '@tsh/openapi';
import { EngineClient } from '../../engine/engine-client';
import { Masker } from '../../masking/masker';
import { RequestContext } from '../../request-context/request-context';
import { ConnectorHealthTool } from './connector-health.tool';

type AuditEntry = components['schemas']['AuditEventResponseDto'];
type OnboardingSummary = components['schemas']['AdminOnboardingSummaryResponseDto'];

const CONTEXT: RequestContext = { identity: { kind: 'local' } };

let sequence = 0;
function entry(action: string, metadata: Record<string, unknown>): AuditEntry {
  sequence += 1;
  return {
    id: `entry-${sequence}`,
    occurredAt: '2026-10-01T10:00:00.000Z',
    actorType: 'system',
    actorId: 'engine',
    action,
    resourceType: 'onboarding',
    resourceId: `onboarding-${sequence}`,
    metadata,
  };
}

function parkedOn(connectorId: string, index: number): OnboardingSummary {
  return {
    onboardingId: `parked-${connectorId}-${index}`,
    pendingConnector: {
      connectorId,
      connectorName: connectorId,
      connectorOrder: 1,
      parkedAt: null,
    },
  } as OnboardingSummary;
}

describe('connector_health', () => {
  const audit: Record<string, AuditEntry[]> = {};
  let request: jest.Mock;
  let tool: ConnectorHealthTool;

  beforeEach(() => {
    for (const action of Object.keys(audit)) {
      delete audit[action];
    }
    audit['connector.result_rejected'] = [
      entry('connector.result_rejected', { connectorId: 'sumsub', reason: 'ATTEMPTS_EXHAUSTED' }),
      entry('connector.result_rejected', { connectorId: 'sumsub' }),
      entry('connector.result_rejected', { connectorId: 'smtp_email_otp' }),
    ];
    audit['connector.failure_retried'] = [
      entry('connector.failure_retried', { connectorId: 'sumsub' }),
    ];
    audit['webhook.inbound_callback_applied'] = [
      entry('webhook.inbound_callback_applied', {
        providerIdentity: 'sumsub',
        outcome: 'persisted',
      }),
    ];
    audit['onboarding.pending_connector_reconciled'] = [
      entry('onboarding.pending_connector_reconciled', { connectorId: 'sumsub' }),
    ];
    audit['webhook.inbound_callback_rejected'] = [];

    request = jest.fn(
      (
        _method: string,
        path: string,
        _context: RequestContext,
        args: { query: { action: string; pendingConnectorId?: string } },
      ) => {
        if (path === '/v1/onboardings') {
          const parked = [
            parkedOn('sumsub', 1),
            parkedOn('sumsub', 2),
            parkedOn('smtp_email_otp', 1),
          ];
          return Promise.resolve({
            items: args.query.pendingConnectorId
              ? parked.filter(
                  (o) => o.pendingConnector?.connectorId === args.query.pendingConnectorId,
                )
              : parked,
            meta: { pagination: { totalPages: 1 } },
          });
        }
        return Promise.resolve({
          items: audit[args.query.action] ?? [],
          meta: {
            pagination: {
              totalPages: 1,
              total: args.query.action === 'webhook.inbound_callback_rejected' ? 5 : 0,
            },
          },
        });
      },
    );
    tool = new ConnectorHealthTool(
      { request } as unknown as EngineClient,
      new Masker('k'.repeat(32)),
    );
  });

  it('counts each connector by outcome and adds the live parked count', async () => {
    const result = (await tool.handler({}, CONTEXT)) as {
      connectors: Array<Record<string, unknown>>;
      callbacksRejectedUnattributed: number;
      truncated: string[];
    };

    expect(result.connectors).toEqual([
      expect.objectContaining({
        connectorId: 'smtp_email_otp',
        rejected: 1,
        parked: 1,
        retried: 0,
      }),
      expect.objectContaining({
        connectorId: 'sumsub',
        rejected: 2,
        retried: 1,
        callbacksApplied: 1,
        reconciled: 1,
        parked: 2,
      }),
    ]);
    expect(result.callbacksRejectedUnattributed).toBe(5);
    expect(result.truncated).toEqual([]);
  });

  it('narrows to one connector', async () => {
    const result = (await tool.handler({ connectorId: 'sumsub' }, CONTEXT)) as {
      connectors: Array<{ connectorId: string; parked: number }>;
    };

    expect(result.connectors.map(({ connectorId, parked }) => [connectorId, parked])).toEqual([
      ['sumsub', 2],
    ]);
  });
});
