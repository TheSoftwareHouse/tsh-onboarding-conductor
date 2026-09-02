import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';

const connectorFallbackWorkflowPath = resolve(
  __dirname,
  '../../../../workflows/fixtures/connector-fallback.workflow.json',
);
const connectorFallbackWorkflowConfig = JSON.parse(
  readFileSync(connectorFallbackWorkflowPath, 'utf8'),
);

const SEND_NOTIFICATION_STEP = 'send_notification';
const OPTIONAL_NOTICE_STEP = 'optional_notice';
const SENDGRID_EMAIL_CONNECTOR_ID = 'sendgrid_email';

describe('connector-fallback.workflow.json', () => {
  const definition = validateAndNormalizeWorkflow(connectorFallbackWorkflowConfig);

  it('loads and normalizes through the existing registry with no schema change', () => {
    expect(definition.id).toBe('connector-fallback');
    expect(definition.stepsByName[SEND_NOTIFICATION_STEP]).toBeDefined();
    expect(definition.stepsByName[OPTIONAL_NOTICE_STEP]).toBeDefined();
  });

  it('names retry_then_fallback on the primary, so its declared attempts are spent', () => {
    const declaration = definition.stepsByName[SEND_NOTIFICATION_STEP].connectors.find(
      (connector) => connector.id === SENDGRID_EMAIL_CONNECTOR_ID,
    );

    expect(declaration).toBeDefined();
    expect(declaration?.errorHandler).toBe('retry_then_fallback');
  });

  it("normalizes the chain with the primary's order/async/canReject, its own fieldMapping and config", () => {
    const declaration = definition.stepsByName[SEND_NOTIFICATION_STEP].connectors.find(
      (connector) => connector.id === SENDGRID_EMAIL_CONNECTOR_ID,
    );
    const [unavailable, backup] = declaration?.fallbacks ?? [];

    expect(declaration?.fallbacks).toHaveLength(2);
    expect(unavailable.id).toBe('mock_email_delivery');
    expect(backup.id).toBe('smtp');

    for (const link of [unavailable, backup]) {
      expect(link.type).toBe('email_delivery');
      expect(link.order).toBe(declaration?.order);
      expect(link.async).toBe(declaration?.async);
      expect(link.canReject).toBe(declaration?.canReject);
    }

    // Inherited from the primary, which is what makes the first link runnable without repeating it.
    expect(unavailable.fieldMapping).toEqual(declaration?.fieldMapping);
    expect(unavailable.config).toEqual({ failWithStatus: 503 });
    expect(backup.fieldMapping).toEqual({
      recipient: 'email',
      subject: 'subject',
      firstName: 'firstName',
    });
    expect(backup.config).toEqual({ templatePath: 'fixtures/manual-smtp.html' });
  });

  it("resolves each link's retry policy, overriding the primary field-wise", () => {
    const declaration = definition.stepsByName[SEND_NOTIFICATION_STEP].connectors.find(
      (connector) => connector.id === SENDGRID_EMAIL_CONNECTOR_ID,
    );
    const [unavailable, backup] = declaration?.fallbacks ?? [];

    expect(declaration?.retry).toEqual({ maxAttempts: 3, delayMs: 200 });
    // Declares only `maxAttempts`, so it keeps the interval the slot already declared.
    expect(unavailable.retry).toEqual({ maxAttempts: 1, delayMs: 200 });
    expect(backup.retry).toEqual({ maxAttempts: 3, delayMs: 200 });
  });

  it("survives normalization with step 2's errorHandler and no fallback, demonstrating the handler swap", () => {
    const declaration = definition.stepsByName[OPTIONAL_NOTICE_STEP].connectors.find(
      (connector) => connector.id === SENDGRID_EMAIL_CONNECTOR_ID,
    );

    expect(declaration).toBeDefined();
    expect(declaration?.errorHandler).toBe('continue_on_error');
    expect(declaration?.fallbacks).toEqual([]);
  });
});
