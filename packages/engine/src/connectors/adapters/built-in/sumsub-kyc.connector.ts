import { Inject, Injectable } from '@nestjs/common';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../storage/object-storage.port';
import { ConnectorSettingsService } from '../../connector-settings.service';
import { AwaitingCallbackConnectorResolver } from '../../resolvers/awaiting-callback-connector.resolver';
import { CompletedOnboardingDocumentResolver } from '../../resolvers/completed-onboarding-document.resolver';
import { KycConnector } from './kyc/kyc-connector';
import { SumsubKycProvider, type SumsubCallbackEvent } from './sumsub-kyc/sumsub-kyc.provider';

/**
 * Sumsub on the KYC kernel: submits an onboarding's captured identity data and parks the step for
 * the provider's callback. The behaviour lives in `KycConnector`; the wire half in
 * `SumsubKycProvider`.
 */
@Injectable()
export class SumsubKycConnector extends KycConnector<SumsubCallbackEvent> {
  constructor(
    provider: SumsubKycProvider,
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
