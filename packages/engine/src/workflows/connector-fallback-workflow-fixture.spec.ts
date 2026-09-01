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

  it('normalizes the primary connector with no errorHandler, proving the default applies', () => {
    const declaration = definition.stepsByName[SEND_NOTIFICATION_STEP].connectors.find(
      (connector) => connector.id === SENDGRID_EMAIL_CONNECTOR_ID,
    );

    expect(declaration).toBeDefined();
    expect(declaration?.errorHandler).toBeUndefined();
  });

  it("normalizes the fallback with the primary's order/async/canReject, its own fieldMapping and config", () => {
    const declaration = definition.stepsByName[SEND_NOTIFICATION_STEP].connectors.find(
      (connector) => connector.id === SENDGRID_EMAIL_CONNECTOR_ID,
    );
    const fallback = declaration?.fallback;

    expect(fallback).toBeDefined();
    expect(fallback?.id).toBe('smtp');
    expect(fallback?.type).toBe('email_delivery');
    expect(fallback?.order).toBe(declaration?.order);
    expect(fallback?.async).toBe(declaration?.async);
    expect(fallback?.canReject).toBe(declaration?.canReject);
    expect(fallback?.fieldMapping).toEqual({
      recipient: 'email',
      subject: 'subject',
      firstName: 'firstName',
    });
    expect(fallback?.config).toEqual({ templatePath: 'fixtures/manual-smtp.html' });
  });

  it("survives normalization with step 2's errorHandler and no fallback, demonstrating the handler swap", () => {
    const declaration = definition.stepsByName[OPTIONAL_NOTICE_STEP].connectors.find(
      (connector) => connector.id === SENDGRID_EMAIL_CONNECTOR_ID,
    );

    expect(declaration).toBeDefined();
    expect(declaration?.errorHandler).toBe('continue_on_error');
    expect(declaration?.fallback).toBeUndefined();
  });
});
