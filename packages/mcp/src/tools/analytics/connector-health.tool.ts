import { Injectable } from '@nestjs/common';
import type { components } from '@tsh/openapi';
import { collectPages } from '../../engine/collect-pages';
import { EngineClient } from '../../engine/engine-client';
import { ENGINE_PAGE_SIZE } from '../../engine/engine.constants';
import { Masker } from '../../masking/masker';
import { RequestContext } from '../../request-context/request-context';
import { McpTool, ToolArguments, ToolKind, ToolRegistration } from '../tool-registration';
import { mapWithConcurrency } from '../shared/map-with-concurrency';
import { ENGINE_READ_CONCURRENCY, ONBOARDING_RESOURCE_TYPE } from '../shared/shared.constants';
import { findDateRange, findString } from '../shared/tool-arguments';
import { MAX_PAGES_PER_QUERY } from './analytics.constants';

type AuditEntry = components['schemas']['AuditEventResponseDto'];

interface ConnectorCounts {
  /** `connector.failure_retried`: the error handler ran the connector again. */
  retried: number;
  /** `connector.failure_fell_back`: a fallback connector took over. */
  fellBack: number;
  /** `connector.failure_ignored`: the failure was swallowed. */
  ignored: number;
  /** `connector.failure_propagated`: the failure ended the step. */
  propagated: number;
  /** `connector.execution_unavailable`: the connector could not be run at all. */
  unavailable: number;
  /** `connector.result_rejected`: the connector refused the applicant. */
  rejected: number;
  /** `connector.result_invalid_data`: the connector found the submitted data invalid. */
  invalid: number;
  /** `webhook.inbound_callback_applied`: a provider's callback decided a parked onboarding. */
  callbacksApplied: number;
  /** `onboarding.pending_connector_reconciled`: an operator read a verdict back from the provider. */
  reconciled: number;
  /** `onboarding.pending_connector_reconcile_noop`: a reconcile that changed nothing. */
  reconcileNoop: number;
  /** Onboardings parked on the connector right now, whatever the window. */
  parked: number;
}

/** What each audit action adds to a connector's counts, and which metadata key names the connector. */
const ACTION_COUNTERS: ReadonlyMap<
  string,
  { counter: keyof ConnectorCounts; connectorKey: 'connectorId' | 'providerIdentity' }
> = new Map([
  ['connector.failure_retried', { counter: 'retried', connectorKey: 'connectorId' }],
  ['connector.failure_fell_back', { counter: 'fellBack', connectorKey: 'connectorId' }],
  ['connector.failure_ignored', { counter: 'ignored', connectorKey: 'connectorId' }],
  ['connector.failure_propagated', { counter: 'propagated', connectorKey: 'connectorId' }],
  ['connector.execution_unavailable', { counter: 'unavailable', connectorKey: 'connectorId' }],
  ['connector.result_rejected', { counter: 'rejected', connectorKey: 'connectorId' }],
  ['connector.result_invalid_data', { counter: 'invalid', connectorKey: 'connectorId' }],
  [
    'webhook.inbound_callback_applied',
    { counter: 'callbacksApplied', connectorKey: 'providerIdentity' },
  ],
  [
    'onboarding.pending_connector_reconciled',
    { counter: 'reconciled', connectorKey: 'connectorId' },
  ],
  [
    'onboarding.pending_connector_reconcile_noop',
    { counter: 'reconcileNoop', connectorKey: 'connectorId' },
  ],
]);

/** A refused callback names no connector or onboarding, so it can only be counted as a whole. */
const CALLBACK_REJECTED_ACTION = 'webhook.inbound_callback_rejected';
const PROVIDER_CALLBACK_RESOURCE_TYPE = 'provider_callback';
const PARKED_SOURCE = 'parked';

function createCounts(): ConnectorCounts {
  return {
    retried: 0,
    fellBack: 0,
    ignored: 0,
    propagated: 0,
    unavailable: 0,
    rejected: 0,
    invalid: 0,
    callbacksApplied: 0,
    reconciled: 0,
    reconcileNoop: 0,
    parked: 0,
  };
}

/** How each connector has behaved in a window, from the audit log and the live parked list. */
@McpTool()
@Injectable()
export class ConnectorHealthTool implements ToolRegistration {
  readonly kind = ToolKind.READ;
  readonly name = 'connector_health';
  readonly description =
    'Reports how each connector (identity, email, SMS or other provider adapter) behaved in a ' +
    'time window: failures by what the error handler did (retried, fellBack, ignored, ' +
    'propagated), unavailable, rejected (the connector refused the applicant), invalid (it ' +
    'found the submitted data invalid), callbacksApplied, reconciled and reconcileNoop, plus how ' +
    'many onboardings are parked on it right now (parked, not limited to the window). Use it to ' +
    'tell whether a provider is failing, slow to call back, or rejecting unusually often. ' +
    'from and to bound the window by ISO-8601 date or date-time; connectorId narrows to one ' +
    'connector. Refused provider callbacks name no connector, so they come as one total, ' +
    '`callbacksRejectedUnattributed`. `truncated` lists any source cut at its page limit; its ' +
    'counts are then lower bounds.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      from: {
        type: 'string',
        description: 'Window start, an ISO-8601 date or date-time (default: unbounded).',
      },
      to: {
        type: 'string',
        description: 'Window end, an ISO-8601 date or date-time (default: unbounded).',
      },
      connectorId: { type: 'string', description: 'Only this connector.' },
    },
    additionalProperties: false,
  };

  constructor(
    private readonly engine: EngineClient,
    private readonly masker: Masker,
  ) {}

  async handler(args: ToolArguments, context: RequestContext): Promise<object> {
    const connectorId = findString(args, 'connectorId');
    const { from, to } = findDateRange(args, 'from', 'to');
    const window = { occurredFrom: from?.toISOString(), occurredTo: to?.toISOString() };

    const [auditReads, parkedRead, callbacksRejected] = await Promise.all([
      mapWithConcurrency([...ACTION_COUNTERS.keys()], ENGINE_READ_CONCURRENCY, async (action) => ({
        action,
        ...(await collectPages<AuditEntry>(
          (page) =>
            this.engine.request('get', '/v1/admin/audit', context, {
              query: {
                action,
                resourceType: ONBOARDING_RESOURCE_TYPE,
                ...window,
                page,
                limit: ENGINE_PAGE_SIZE,
              },
            }),
          MAX_PAGES_PER_QUERY,
          { getKey: (entry) => entry.id },
        )),
      })),
      collectPages(
        (page) =>
          this.engine.request('get', '/v1/onboardings', context, {
            query: { parked: true, pendingConnectorId: connectorId, page, limit: ENGINE_PAGE_SIZE },
          }),
        MAX_PAGES_PER_QUERY,
        { getKey: (onboarding) => onboarding.onboardingId },
      ),
      this.engine.request('get', '/v1/admin/audit', context, {
        query: {
          action: CALLBACK_REJECTED_ACTION,
          resourceType: PROVIDER_CALLBACK_RESOURCE_TYPE,
          ...window,
          limit: 1,
        },
      }),
    ]);

    const connectors = new Map<string, ConnectorCounts>();
    const getCounts = (id: string): ConnectorCounts => {
      const counts = connectors.get(id) ?? createCounts();
      connectors.set(id, counts);
      return counts;
    };

    for (const { action, items } of auditReads) {
      const { counter, connectorKey } = ACTION_COUNTERS.get(action)!;

      for (const entry of items) {
        const id = this.masker.maskAuditEntry(entry).metadata[connectorKey];
        if (typeof id === 'string') {
          getCounts(id)[counter]++;
        }
      }
    }

    for (const { pendingConnector } of parkedRead.items) {
      if (pendingConnector) {
        getCounts(pendingConnector.connectorId).parked++;
      }
    }

    return {
      connectors: [...connectors]
        .filter(([id]) => connectorId === undefined || id === connectorId)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, counts]) => ({ connectorId: id, ...counts })),
      callbacksRejectedUnattributed: callbacksRejected.meta.pagination.total,
      truncated: [
        ...auditReads.filter(({ truncated }) => truncated).map(({ action }) => action),
        ...(parkedRead.truncated ? [PARKED_SOURCE] : []),
      ],
    };
  }
}
