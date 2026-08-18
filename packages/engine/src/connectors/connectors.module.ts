import { Module } from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { OnboardingDocumentEntity } from '../onboardings/entity/onboarding-document.entity';
import { CompletedOnboardingDocumentResolver } from './resolvers/completed-onboarding-document.resolver';
import { HttpRequestConnector } from './adapters/production/http-request.connector';
import { SendgridEmailConnector } from './adapters/production/sendgrid-email.connector';
import { SmtpEmailConnector } from './adapters/production/smtp-email.connector';
import { TwilioVerifyConnector } from './adapters/production/twilio-verify.connector';
import { MockAsyncCallbackConnector } from './adapters/sandbox/mock-async-callback.connector';
import { MockEmailOtpConnector } from './adapters/sandbox/mock-email-otp.connector';
import { MockKyc1Connector } from './adapters/sandbox/mock-kyc-1.connector';
import { MockKyc2Connector } from './adapters/sandbox/mock-kyc-2.connector';
import { MockSmsOtpConnector } from './adapters/sandbox/mock-sms-otp.connector';
import { MockSumsubFileUploadConnector } from './adapters/sandbox/mock-sumsub-file-upload.connector';
import { ConnectorTierMismatchError } from './errors/connector-tier-mismatch.error';
import { DuplicateConnectorAdapterRegistrationError } from './errors/duplicate-connector-adapter-registration.error';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  ConnectorTier,
  type ConnectorAdapterCollection,
} from './ports/connector-adapter.port';
import {
  WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
} from './ports/connector-execution.port';
import { WorkflowConnectorExecutorService } from './workflow-connector-executor.service';

/**
 * Adapters that talk to a real provider. Always registered.
 *
 * Adding an entry here is a deliberate act: everything listed is reachable by any workflow in
 * production. `assertProvidersMatchDeclaredTier` fails startup if one of these declares itself
 * as sandbox.
 */
const PRODUCTION_CONNECTOR_PROVIDERS = [
  HttpRequestConnector,
  SendgridEmailConnector,
  SmtpEmailConnector,
  TwilioVerifyConnector,
] as const;

/**
 * Adapters that fake their provider. Registered only when SANDBOX_CONNECTORS_ENABLED is set,
 * which AppConfig refuses to accept under NODE_ENV=production.
 */
const SANDBOX_CONNECTOR_PROVIDERS = [
  MockAsyncCallbackConnector,
  MockEmailOtpConnector,
  MockKyc1Connector,
  MockKyc2Connector,
  MockSmsOtpConnector,
  MockSumsubFileUploadConnector,
] as const;

const ALL_CONNECTOR_PROVIDERS = [
  ...PRODUCTION_CONNECTOR_PROVIDERS,
  ...SANDBOX_CONNECTOR_PROVIDERS,
] as const;

const CONNECTOR_ADAPTER_INJECT_TOKENS: InjectionToken[] = [...ALL_CONNECTOR_PROVIDERS];

const assertUniqueConnectorTypes = (connectors: ConnectorAdapterCollection): void => {
  const counts = new Map<string, number>();

  for (const connector of connectors) {
    counts.set(connector.type, (counts.get(connector.type) ?? 0) + 1);
  }

  const duplicateTypes = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([type]) => type)
    .sort();

  if (duplicateTypes.length > 0) {
    throw new DuplicateConnectorAdapterRegistrationError(duplicateTypes.join(', '));
  }
};

/**
 * Guards against a sandbox adapter being copy-pasted into the production list (or vice versa):
 * the list an adapter is registered in must agree with the tier the adapter declares.
 */
const assertProvidersMatchDeclaredTier = (
  connectors: ConnectorAdapterCollection,
  registeredTier: ConnectorTier,
): void => {
  for (const connector of connectors) {
    if (connector.tier !== registeredTier) {
      throw new ConnectorTierMismatchError(connector.type, registeredTier, connector.tier);
    }
  }
};

@Module({
  imports: [ConfigModule, StorageModule, TypeOrmModule.forFeature([OnboardingDocumentEntity])],
  providers: [
    CompletedOnboardingDocumentResolver,
    ...ALL_CONNECTOR_PROVIDERS,
    {
      provide: CONNECTOR_ADAPTER_COLLECTION,
      useFactory: (
        configService: ConfigService,
        ...connectors: ConnectorAdapterCollection
      ): ConnectorAdapterCollection => {
        // Nest resolves factory arguments in `inject` order, so the production providers arrive
        // first and the sandbox ones after them. Splitting on that boundary tells us which list
        // each adapter was registered in, which `instanceof` cannot do once a test (or anything
        // else) substitutes a provider with a plain value.
        const production = connectors.slice(0, PRODUCTION_CONNECTOR_PROVIDERS.length);
        const sandbox = connectors.slice(PRODUCTION_CONNECTOR_PROVIDERS.length);

        assertProvidersMatchDeclaredTier(production, ConnectorTier.PRODUCTION);
        assertProvidersMatchDeclaredTier(sandbox, ConnectorTier.SANDBOX);

        const sandboxEnabled = configService.get<boolean>('SANDBOX_CONNECTORS_ENABLED') === true;
        const registered = sandboxEnabled ? [...production, ...sandbox] : production;

        assertUniqueConnectorTypes(registered);

        return registered;
      },
      inject: [ConfigService, ...CONNECTOR_ADAPTER_INJECT_TOKENS],
    },
    WorkflowConnectorExecutorService,
    {
      provide: WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
      useExisting: WorkflowConnectorExecutorService,
    },
    {
      provide: WORKFLOW_CONNECTOR_EXECUTION_PORT,
      useExisting: WorkflowConnectorExecutorService,
    },
  ],
  exports: [WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT],
})
export class ConnectorsModule {}
