import { ConnectorExecutionResult } from '../../ports/connector-execution-result';
import { MockEmailDeliveryConnector } from './mock-email-delivery.connector';

const send = (
  payload: Record<string, unknown>,
  options: { onboardingId?: string; async?: boolean } = {},
) => ({
  declaration: { order: 1, config: {}, async: options.async },
  execution: { onboardingId: options.onboardingId ?? 'onboarding-1', stepName: 'send_email' },
  context: {},
  payload,
  payloadFieldSources: {},
});

const canonicalPayload = {
  recipient: 'person@example.com',
  templateId: 'welcome',
  'data.first_name': ' Ada ',
};

describe('MockEmailDeliveryConnector', () => {
  it('is registered under its own connector type and accepts callbacks', () => {
    const connector = new MockEmailDeliveryConnector();

    expect(connector.id).toBe('mock_email_delivery');
    expect(connector.type).toBe('email_delivery');
    expect(connector.supportsAsyncCallback).toBe(true);
  });

  it('accepts a message and keeps it for the test to inspect', async () => {
    const connector = new MockEmailDeliveryConnector();

    await expect(connector.execute(send(canonicalPayload))).resolves.toEqual(
      ConnectorExecutionResult.accepted(),
    );

    expect(connector.__peekDeliveredEmailsForTests('onboarding-1')).toEqual([
      {
        onboardingId: 'onboarding-1',
        stepName: 'send_email',
        recipient: 'person@example.com',
        templateId: 'welcome',
        data: { first_name: 'Ada' },
      },
    ]);
  });

  it('reads the template-variable wording of the providers it stands in for', async () => {
    const connector = new MockEmailDeliveryConnector();

    await connector.execute(
      send({
        recipient: 'person@example.com',
        templateId: 'd-template-id',
        'dynamicTemplateData.first_name': 'Ada',
        'dynamicTemplateData.visits': 3,
      }),
    );

    expect(connector.__peekDeliveredEmailsForTests('onboarding-1')[0]).toMatchObject({
      templateId: 'd-template-id',
      data: { first_name: 'Ada', visits: 3 },
    });
  });

  it('keeps the messages of each onboarding apart and forgets them on reset', async () => {
    const connector = new MockEmailDeliveryConnector();

    await connector.execute(send(canonicalPayload, { onboardingId: 'onboarding-1' }));
    await connector.execute(send(canonicalPayload, { onboardingId: 'onboarding-2' }));

    expect(connector.__peekDeliveredEmailsForTests('onboarding-2')).toHaveLength(1);
    expect(connector.__peekDeliveredEmailsForTests()).toHaveLength(2);

    connector.__resetForTests();
    expect(connector.__peekDeliveredEmailsForTests()).toHaveLength(0);
  });

  it('reports an invalid declaration when the recipient or template is missing', async () => {
    const connector = new MockEmailDeliveryConnector();

    await expect(connector.execute(send({ templateId: 'welcome' }))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    await expect(connector.execute(send({ recipient: 'person@example.com' }))).resolves.toEqual(
      ConnectorExecutionResult.invalid(),
    );
    expect(connector.__peekDeliveredEmailsForTests()).toHaveLength(0);
  });

  describe('asynchronous declarations', () => {
    it('accepts for delivery and lets the callback confirm it landed', async () => {
      const connector = new MockEmailDeliveryConnector();

      await expect(connector.execute(send(canonicalPayload, { async: true }))).resolves.toEqual(
        ConnectorExecutionResult.accepted(),
      );

      const initiation = connector.__peekInitiationForTests('onboarding-1');
      expect(initiation?.detail).toMatchObject({ recipient: 'person@example.com' });

      await expect(
        connector.mapCallbackResult(
          connector.__buildProviderCallbackForTests({
            providerReference: initiation?.providerReference,
            status: 'delivered',
            submittedData: { deliveredAt: '2026-08-19T10:00:00.000Z' },
          }),
        ),
      ).resolves.toEqual({
        onboardingId: 'onboarding-1',
        submittedData: { deliveredAt: '2026-08-19T10:00:00.000Z' },
        resolvedConnector: { connectorOrder: 1 },
        result: ConnectorExecutionResult.accepted(),
      });
    });

    it('turns a bounce into a terminal rejection and refuses an unknown status', async () => {
      const connector = new MockEmailDeliveryConnector();
      await connector.execute(send(canonicalPayload, { async: true }));
      const initiation = connector.__peekInitiationForTests('onboarding-1');

      const bounced = await connector.mapCallbackResult(
        connector.__buildProviderCallbackForTests({
          providerReference: initiation?.providerReference,
          status: 'bounced',
        }),
      );
      expect(bounced.result).toEqual(ConnectorExecutionResult.rejected('CONNECTOR_REJECTED'));

      await expect(
        connector.mapCallbackResult(
          connector.__buildProviderCallbackForTests({
            providerReference: initiation?.providerReference,
            status: 'teleported',
          }),
        ),
      ).rejects.toThrow('status must be one of delivered, bounced, dropped');
    });

    it('records no callback correlation for a synchronous declaration', async () => {
      const connector = new MockEmailDeliveryConnector();

      await connector.execute(send(canonicalPayload));

      expect(connector.__peekInitiationForTests('onboarding-1')).toBeUndefined();
    });
  });
});
