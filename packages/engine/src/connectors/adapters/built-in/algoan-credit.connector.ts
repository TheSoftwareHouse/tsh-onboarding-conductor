import { Inject, Injectable } from '@nestjs/common';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../storage/object-storage.port';
import { ConnectorSettingsService } from '../../connector-settings.service';
import { AwaitingCallbackConnectorResolver } from '../../resolvers/awaiting-callback-connector.resolver';
import { CompletedOnboardingDocumentResolver } from '../../resolvers/completed-onboarding-document.resolver';
import { AlgoanCreditProvider } from './algoan-credit/algoan-credit.provider';
import { CreditConnector } from './credit/credit-connector';

/**
 * Algoan on the credit kernel: submits an onboarding's bank-data document and parks the step for
 * the provider's callback. The behaviour lives in `CreditConnector`; the wire half in
 * `AlgoanCreditProvider`.
 */
@Injectable()
export class AlgoanCreditConnector extends CreditConnector {
  constructor(
    provider: AlgoanCreditProvider,
    connectorSettingsService: ConnectorSettingsService,
    documentResolver: CompletedOnboardingDocumentResolver,
    @Inject(OBJECT_STORAGE_PORT) objectStoragePort: ObjectStoragePort,
    awaitingCallbackConnectorResolver: AwaitingCallbackConnectorResolver,
  ) {
    super(
      provider,
      connectorSettingsService,
      documentResolver,
      objectStoragePort,
      awaitingCallbackConnectorResolver,
    );
  }
}
